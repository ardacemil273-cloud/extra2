import { prisma } from '../prisma';
import type { LiveRoom, LivePlayer } from './store';

export async function persistRoomCreate(
  data: {
    id: string;
    code: string;
    name: string;
    ownerId: string;
    isPrivate?: boolean;
    passwordHash?: string | null;
    inviteToken?: string | null;
    maxPlayers?: number | null;
  },
  hostPlayer: { userId: string },
): Promise<void> {
  await prisma.room.create({
    data: {
      id: data.id,
      code: data.code,
      name: data.name,
      ownerId: data.ownerId,
      status: 'lobby',
      isPrivate: data.isPrivate ?? false,
      passwordHash: data.passwordHash ?? null,
      inviteToken: data.inviteToken ?? null,
      maxPlayers: data.maxPlayers ?? null,
      players: {
        create: { userId: hostPlayer.userId },
      },
    },
  });
}

export async function upsertPlayer(room: LiveRoom, player: LivePlayer): Promise<void> {
  const existing = await prisma.player.findUnique({
    where: { userId_roomId: { userId: player.userId, roomId: room.id } },
  });
  if (existing) return;
  await prisma.player.create({
    data: {
      userId: player.userId,
      roomId: room.id,
      isReady: player.isReady,
      spectator: player.isSpectator,
    },
  });
}

export async function setPlayerSpectator(roomId: string, userId: string, spectator: boolean): Promise<void> {
  await prisma.player.updateMany({
    where: { userId, roomId },
    data: { spectator },
  });
}

export async function deletePlayerRecord(userId: string, roomId: string): Promise<void> {
  await prisma.player.deleteMany({
    where: { userId, roomId },
  });
}

export async function setPlayerReady(userId: string, roomId: string, isReady: boolean): Promise<void> {
  await prisma.player.updateMany({
    where: { userId, roomId },
    data: { isReady },
  });
}

export async function setRoomGameType(roomId: string, gameType: string | null): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data: { gameType },
  });
}

export async function setRoomStatus(roomId: string, status: string): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data: { status },
  });
}

export async function transferRoomOwnership(roomId: string, newOwnerId: string): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data: { ownerId: newOwnerId },
  });
}

export async function closeRoom(room: LiveRoom): Promise<void> {
  await prisma.room.update({
    where: { id: room.id },
    data: { status: 'closed', closedAt: new Date() },
  });
}

export async function persistScores(room: LiveRoom): Promise<void> {
  const updates = Array.from(room.players.values()).map((p) =>
    prisma.player.updateMany({
      where: { userId: p.userId, roomId: room.id },
      data: { score: p.score },
    }),
  );
  await Promise.all(updates);
}

export async function persistChatMessage(roomId: string, data: { userId: string; text: string }): Promise<void> {
  await prisma.chatMessage.create({
    data: { roomId, userId: data.userId, text: data.text },
  });
}

export async function persistReaction(roomId: string, data: { userId: string; emoji: string }): Promise<void> {
  await prisma.reaction.create({
    data: { roomId, userId: data.userId, emoji: data.emoji },
  });
}

export async function setRoomPassword(
  roomId: string,
  data: { isPrivate: boolean; passwordHash: string | null },
): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data,
  });
}

export async function setRoomMaxPlayers(roomId: string, maxPlayers: number | null): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data: { maxPlayers },
  });
}

export async function setRoomVibe(roomId: string, vibe: string): Promise<void> {
  await prisma.room.update({
    where: { id: roomId },
    data: { vibe },
  });
}
