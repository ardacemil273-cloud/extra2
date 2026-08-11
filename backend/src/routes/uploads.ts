import type { Request, Response } from 'express';
import { z } from 'zod';
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { getAllRooms, emitToRoom, toRoomState } from '../socket/store';

const router = Router();

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.join(UPLOAD_ROOT, 'ads'), { recursive: true });
  await fs.mkdir(path.join(UPLOAD_ROOT, 'avatars'), { recursive: true });
}

function validExt(mime: string): string | null {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return map[mime] ?? null;
}

async function saveBase64Image(dataUrl: unknown, subdir: string, maxBytes: number): Promise<string | null> {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:([a-z0-9/+\-.]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const ext = validExt(match[1]);
  if (!ext) return null;
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length < 64 || buf.length > maxBytes) return null;
  await ensureDirs();
  const filename = `${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`;
  const filepath = path.join(UPLOAD_ROOT, subdir, filename);
  await fs.writeFile(filepath, buf);
  return `/uploads/${subdir}/${filename}`;
}

const adConfigSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().max(80).optional(),
  subtitle: z.string().max(160).optional(),
  url: z.string().max(300).optional(),
});

function defaultAd() {
  return {
    enabled: false,
    title: 'Join our Discord',
    subtitle: 'Hang out, find parties and get game news.',
    url: 'https://discord.gg/partyverse',
    imageUrl: null,
  };
}

async function getAd() {
  const row = await prisma.siteConfig.findUnique({ where: { key: 'discord_ad' } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const base = defaultAd();
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : base.enabled,
    title: typeof value.title === 'string' ? value.title : base.title,
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : base.subtitle,
    url: typeof value.url === 'string' ? value.url : base.url,
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : null,
  };
}

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  const ad = await getAd();
  res.json({ ad });
});

router.put('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = adConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid ad configuration.' });
    return;
  }
  const current = await getAd();
  const next = { ...current, ...parsed.data };
  await prisma.siteConfig.upsert({
    where: { key: 'discord_ad' },
    create: { key: 'discord_ad', value: next },
    update: { value: next },
  });
  res.json({ ad: next });
});

router.post('/image', requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ dataUrl: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid image payload.' });
    return;
  }
  const url = await saveBase64Image(parsed.data.dataUrl, 'ads', 2 * 1024 * 1024);
  if (!url) {
    res.status(400).json({ error: 'invalid-image', message: 'Image must be PNG, JPEG, GIF or WebP and under 2MB.' });
    return;
  }
  const current = await getAd();
  const next = { ...current, imageUrl: url };
  await prisma.siteConfig.upsert({
    where: { key: 'discord_ad' },
    create: { key: 'discord_ad', value: next },
    update: { value: next },
  });
  res.json({ ad: next, url });
});

router.post('/avatar', requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ dataUrl: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid image payload.' });
    return;
  }
  const url = await saveBase64Image(parsed.data.dataUrl, 'avatars', 2 * 1024 * 1024);
  if (!url) {
    res.status(400).json({ error: 'invalid-image', message: 'Image must be PNG, JPEG, GIF or WebP and under 2MB.' });
    return;
  }
  const user = await prisma.user.update({
    where: { id: req.authUser!.sub },
    data: { avatarUrl: url },
    select: { id: true, avatarUrl: true },
  });
  for (const room of getAllRooms()) {
    let changed = false;
    const live = room.players.get(user.id) ?? room.spectators.get(user.id);
    if (live && live.avatarUrl !== url) {
      live.avatarUrl = url;
      changed = true;
    }
    if (changed) {
      emitToRoom(room, 'room:update', toRoomState(room));
    }
  }
  res.json({ avatarUrl: url });
});

export default router;
