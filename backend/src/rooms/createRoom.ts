import { prisma } from '../prisma';
import { generateRoomCode } from '../utils/roomCode';
import { createLiveRoom, addPlayerToRoom, type LiveRoom } from '../socket/store';
import { attachFinishHook } from '../socket/finish';
import { hashPassword } from '../utils/password';
import type { GameType, RoomVibe } from '../types';

export interface UserLike {
  id: string;
  username: string;
  avatarColor: string;
}

function randomToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function uniqueRoomCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error('Could not allocate a room code.');
}

export interface CreateRoomOptions {
  name?: string;
  password?: string;
  maxPlayers?: number | null;
  gameType?: GameType | null;
  vibe?: RoomVibe;
  hostReady?: boolean;
}

export async function createRoomForUser(user: UserLike, opts: CreateRoomOptions = {}): Promise<LiveRoom> {
  let code: string;
  try {
    code = await uniqueRoomCode();
  } catch (err) {
    throw new Error((err as Error).message);
  }
  const password = opts.password?.trim();
  const passwordHash = password ? await hashPassword(password) : null;
  const name = opts.name?.trim() || `${user.username}'s party`;
  const inviteToken = randomToken();
  const vibe = opts.vibe ?? 'mixed';
  const room = await prisma.room.create({
    data: {
      code,
      name,
      ownerId: user.id,
      isPrivate: passwordHash !== null,
      passwordHash,
      inviteToken,
      maxPlayers: opts.maxPlayers ?? null,
      gameType: opts.gameType ?? null,
      vibe,
      players: {
        create: { userId: user.id, isReady: opts.hostReady ?? false },
      },
    },
  });
  const liveRoom = createLiveRoom({
    id: room.id,
    code,
    name,
    ownerId: user.id,
    isPrivate: passwordHash !== null,
    passwordHash,
    inviteToken,
    maxPlayers: opts.maxPlayers ?? null,
    vibe,
  });
  addPlayerToRoom(liveRoom, {
    userId: user.id,
    username: user.username,
    avatarColor: user.avatarColor,
    avatarUrl: null,
    isHost: true,
    isReady: opts.hostReady ?? false,
    score: 0,
  });
  liveRoom.gameType = opts.gameType ?? null;
  attachFinishHook(liveRoom);
  return liveRoom;
}

export { randomToken };
