import type { Request, Response } from 'express';
import { z } from 'zod';
import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { createRoomForUser } from '../rooms/createRoom';
import { toRoomState, getRoomByCode, type LiveRoom } from '../socket/store';
import { clientUrl } from '../utils/clientUrl';
import type { GameType } from '../types';

const router = Router();

const GAME_TYPES: GameType[] = ['quiz', 'reaction', 'rps', 'draw', 'telephone', 'sabotaj', 'chameleon', 'reveal'];

const createRoomSchema = z.object({
  name: z.string().min(1, 'Room name is required.').max(40, 'Room name is too long.').optional(),
  password: z.string().min(3, 'Password must be at least 3 characters.').max(64).optional(),
  maxPlayers: z.number().int().min(2).max(32).nullable().optional(),
  gameType: z.enum(GAME_TYPES as unknown as [string, ...string[]]).nullable().optional(),
  vibe: z.enum(['friends', 'spice', 'chaos', 'mixed']).optional(),
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: parsed.error.errors[0].message });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.authUser!.sub } });
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'User not found.' });
    return;
  }
  let liveRoom: LiveRoom;
  try {
    liveRoom = await createRoomForUser(user, {
      name: parsed.data.name,
      password: parsed.data.password,
      maxPlayers: parsed.data.maxPlayers,
      gameType: (parsed.data.gameType as GameType | null) ?? null,
      vibe: parsed.data.vibe ?? 'mixed',
    });
  } catch (err) {
    res.status(500).json({ error: 'internal', message: (err as Error).message });
    return;
  }
  res.status(201).json({ room: toRoomState(liveRoom) });
});

router.get('/active', requireAuth, async (_req: Request, res: Response) => {
  const rooms = await prisma.room.findMany({
    where: { status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    include: { _count: { select: { players: true } } },
  });
  res.json({
    rooms: rooms.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      gameType: r.gameType,
      isPrivate: r.isPrivate,
      playerCount: r._count.players,
      ownerId: r.ownerId,
      createdAt: r.createdAt,
    })),
  });
});

function resolveInviteRoom(_req: Request, res: Response, inviteToken: string): void {
  void resolveInviteForToken(inviteToken, res);
}

async function resolveInviteForToken(inviteToken: string, res: Response): Promise<void> {
  const dbRoom = await prisma.room.findUnique({ where: { inviteToken } });
  if (!dbRoom || dbRoom.status === 'closed') {
    res.status(404).json({ error: 'not-found', message: 'Invite link is invalid or expired.' });
    return;
  }
  const room = getRoomByCode(dbRoom.code);
  const live = room
    ? toRoomState(room)
    : {
        room: {
          id: dbRoom.id,
          code: dbRoom.code,
          name: dbRoom.name,
          ownerId: dbRoom.ownerId,
          status: dbRoom.status as 'lobby',
          gameType: (dbRoom.gameType ?? null) as GameType | null,
          vibe: (dbRoom.vibe as 'friends' | 'spice' | 'chaos' | 'mixed') ?? 'mixed',
          isPrivate: dbRoom.isPrivate,
          hasPassword: dbRoom.passwordHash !== null,
          maxPlayers: dbRoom.maxPlayers,
          createdAt: dbRoom.createdAt.toISOString(),
        },
        players: [],
        spectators: [],
      };
  const resolved = {
    code: dbRoom.code,
    name: dbRoom.name,
    hasPassword: dbRoom.passwordHash !== null,
    password: dbRoom.passwordHash ? '' : null,
    status: dbRoom.status,
    gameType: dbRoom.gameType,
    vibe: dbRoom.vibe ?? 'mixed',
    state: live,
  };
  res.json({ invite: resolved });
}

router.get('/invite/:token', requireAuth, (req: Request, res: Response) => {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  if (!/^[A-Za-z0-9]{16,32}$/.test(token)) {
    res.status(404).json({ error: 'not-found', message: 'Invite link is invalid.' });
    return;
  }
  resolveInviteRoom(req, res, token);
});

router.get('/:id/invite', requireAuth, async (req: Request, res: Response) => {
  const roomId = req.params.id;
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.status === 'closed') {
    res.status(404).json({ error: 'not-found', message: 'Room not found.' });
    return;
  }
  const membership = await prisma.player.findUnique({
    where: { userId_roomId: { userId: req.authUser!.sub, roomId } },
  });
  if (!membership) {
    res.status(403).json({ error: 'forbidden', message: 'You are not in this room.' });
    return;
  }
  if (room.inviteToken) {
    res.json({
      invite: {
        code: room.code,
        token: room.inviteToken,
        url: clientUrl(req, `/join/${room.inviteToken}`),
        hasPassword: room.passwordHash !== null,
      },
    });
    return;
  }
  const crypto = await import('crypto');
  const token = crypto.randomBytes(16).toString('base64url').slice(0, 24);
  await prisma.room.update({ where: { id: roomId }, data: { inviteToken: token } });
  res.json({
    invite: {
      code: room.code,
      token,
      url: clientUrl(req, `/join/${token}`),
      hasPassword: room.passwordHash !== null,
    },
  });
});

export default router;
