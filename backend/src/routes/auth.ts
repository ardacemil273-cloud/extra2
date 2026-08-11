import type { Request, Response } from 'express';
import { z } from 'zod';
import { Router } from 'express';
import { prisma } from '../prisma';
import { hashPassword, comparePassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { censor } from '../utils/profanity';
import { generateReferralCode, resolveReferral } from '../social/referral';

const router = Router();

const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters.')
    .max(20, 'Username must be at most 20 characters.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores.'),
  email: z.string().email('Invalid email address.').max(120),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
  referralCode: z.string().max(16).optional(),
});

const loginSchema = z.object({
  identifier: z.string().min(1).max(120),
  password: z.string().min(1).max(128),
});

const AVATAR_COLORS = ['#7c3aed', '#2563eb', '#06b6d4', '#db2777', '#ea580c', '#16a34a', '#e11d48', '#4f46e5'];

function safeUser(user: {
  id: string;
  username: string;
  email: string;
  avatarColor: string;
  avatarUrl: string | null;
  title: string;
  bio: string;
  interests: string[];
  seasonXp: number;
  xp: number;
  level: number;
  dailyStreak: number;
  createdAt: Date;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl,
    title: user.title,
    bio: user.bio,
    interests: user.interests,
    seasonXp: user.seasonXp,
    xp: user.xp,
    level: user.level,
    dailyStreak: user.dailyStreak,
    createdAt: user.createdAt,
  };
}

router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: parsed.error.errors[0].message });
    return;
  }
  const { username, email, password } = parsed.data;
  if (censor(username) !== username) {
    res.status(400).json({ error: 'validation', message: 'Username contains blocked language.' });
    return;
  }
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (existing) {
    res.status(409).json({ error: 'conflict', message: existing.email === email ? 'Email is already registered.' : 'Username is already taken.' });
    return;
  }
  let invitedBy: string | null = null;
  if (parsed.data.referralCode) {
    invitedBy = await resolveReferral(parsed.data.referralCode);
  }
  const passwordHash = await hashPassword(password);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  let referralCode = generateReferralCode();
  while (await prisma.user.findUnique({ where: { referralCode } })) {
    referralCode = generateReferralCode();
  }
  const user = await prisma.user.create({
    data: { username, email, passwordHash, avatarColor, invitedBy, referralCode },
  });
  const token = signToken({ sub: user.id, username: user.username });
  res.status(201).json({ token, user: safeUser(user), referralCode });
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid credentials.' });
    return;
  }
  const { identifier, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: identifier }, { email: identifier }] },
  });
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid credentials.' });
    return;
  }
  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid credentials.' });
    return;
  }
  const token = signToken({ sub: user.id, username: user.username });
  res.json({ token, user: safeUser(user) });
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.authUser!.sub },
    include: {
      players: {
        orderBy: { joinedAt: 'desc' },
        take: 10,
        include: { room: true },
      },
    },
  });
  if (!user) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const recentRooms = user.players
    .map((p) => ({
      id: p.roomId,
      code: p.room.code,
      name: p.room.name,
      gameType: p.room.gameType,
      status: p.room.status,
      playedAt: p.joinedAt,
    }))
    .filter((r) => r.status !== 'closed');
  res.json({ user: safeUser(user), recentRooms });
});

export default router;
