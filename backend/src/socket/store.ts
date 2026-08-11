import type { Server, Socket } from 'socket.io';
import type {
  ChatMessagePublic,
  GameType,
  PlayerPublic,
  ReactionPublic,
  RoomState,
  RoomVibe,
} from '../types';

export interface LivePlayer {
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  isSpectator: boolean;
  muted: boolean;
  score: number;
  joinedAt: number;
  socketIds: Set<string>;
  reconnectTimer: NodeJS.Timeout | null;
}

export interface LiveRoom {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'lobby' | 'playing' | 'finished';
  gameType: GameType | null;
  vibe: RoomVibe;
  isPrivate: boolean;
  passwordHash: string | null;
  inviteToken: string | null;
  maxPlayers: number | null;
  players: Map<string, LivePlayer>;
  spectators: Map<string, LivePlayer>;
  gameState: unknown;
  timers: NodeJS.Timeout[];
  chat: ChatMessagePublic[];
  reactions: ReactionPublic[];
  createdAt: number;
  lastActivity: number;
  onFinished: (() => void) | null;
}

let ioRef: Server | null = null;

export function setIo(io: Server): void {
  ioRef = io;
}

const roomsByCode = new Map<string, LiveRoom>();
const roomsById = new Map<string, LiveRoom>();

function roomName(roomId: string): string {
  return `room:${roomId}`;
}

export function createLiveRoom(data: {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  isPrivate?: boolean;
  passwordHash?: string | null;
  inviteToken?: string | null;
  maxPlayers?: number | null;
  vibe?: RoomVibe;
}): LiveRoom {
  const room: LiveRoom = {
    id: data.id,
    code: data.code,
    name: data.name,
    ownerId: data.ownerId,
    status: 'lobby',
    gameType: null,
    vibe: data.vibe ?? 'mixed',
    isPrivate: data.isPrivate ?? false,
    passwordHash: data.passwordHash ?? null,
    inviteToken: data.inviteToken ?? null,
    maxPlayers: data.maxPlayers ?? null,
    players: new Map(),
    spectators: new Map(),
    gameState: null,
    timers: [],
    chat: [],
    reactions: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    onFinished: null,
  };
  roomsByCode.set(room.code, room);
  roomsById.set(room.id, room);
  return room;
}

export function deleteLiveRoom(roomId: string): void {
  const room = roomsById.get(roomId);
  if (!room) return;
  clearTimers(room);
  roomsById.delete(roomId);
  roomsByCode.delete(room.code);
}

export function getRoomByCode(code: string): LiveRoom | undefined {
  return roomsByCode.get(code.toUpperCase());
}

export function getRoomById(id: string): LiveRoom | undefined {
  return roomsById.get(id);
}

export function getAllRooms(): LiveRoom[] {
  return Array.from(roomsById.values());
}

export function touchRoom(room: LiveRoom): void {
  room.lastActivity = Date.now();
}

export function addPlayerToRoom(
  room: LiveRoom,
  player: Omit<LivePlayer, 'socketIds' | 'reconnectTimer' | 'connected' | 'joinedAt' | 'isSpectator' | 'muted'>,
  opts?: { spectator?: boolean },
): LivePlayer {
  const live: LivePlayer = {
    ...player,
    isSpectator: opts?.spectator ?? false,
    muted: false,
    connected: true,
    joinedAt: Date.now(),
    socketIds: new Set(),
    reconnectTimer: null,
  };
  if (live.isSpectator) {
    room.spectators.set(player.userId, live);
  } else {
    room.players.set(player.userId, live);
  }
  return live;
}

export function getLivePlayer(room: LiveRoom, userId: string): LivePlayer | undefined {
  return room.players.get(userId) ?? room.spectators.get(userId);
}

export function getPlayerEntry(room: LiveRoom, userId: string): LivePlayer | undefined {
  return room.players.get(userId);
}

export function getSpectatorEntry(room: LiveRoom, userId: string): LivePlayer | undefined {
  return room.spectators.get(userId);
}

export function removePlayerFromRoom(room: LiveRoom, userId: string): void {
  const player = room.players.get(userId) ?? room.spectators.get(userId);
  if (player?.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
  room.players.delete(userId);
  room.spectators.delete(userId);
}

export function clearTimers(room: LiveRoom): void {
  for (const timer of room.timers) {
    clearTimeout(timer);
  }
  room.timers = [];
}

export function addTimer(room: LiveRoom, timer: NodeJS.Timeout): void {
  room.timers.push(timer);
}

export function schedule(room: LiveRoom, fn: () => void, ms: number): NodeJS.Timeout {
  const timer = setTimeout(fn, ms);
  timer.unref();
  addTimer(room, timer);
  return timer;
}

export function playerConnectedSocket(room: LiveRoom, userId: string, socketId: string): void {
  const player = room.players.get(userId) ?? room.spectators.get(userId);
  if (!player) return;
  player.socketIds.add(socketId);
  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }
  player.connected = true;
}

export function playerDisconnectedSocket(room: LiveRoom, userId: string, socketId: string): void {
  const player = room.players.get(userId) ?? room.spectators.get(userId);
  if (!player) return;
  player.socketIds.delete(socketId);
  if (player.socketIds.size > 0) return;
  player.connected = false;
}

export function setReconnectTimer(room: LiveRoom, userId: string, ms: number, onExpire: () => void): void {
  const player = room.players.get(userId) ?? room.spectators.get(userId);
  if (!player) return;
  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  const timer = setTimeout(() => {
    player.reconnectTimer = null;
    onExpire();
  }, ms);
  timer.unref();
  player.reconnectTimer = timer;
}

export function toPlayerPublic(p: LivePlayer): PlayerPublic {
  return {
    userId: p.userId,
    username: p.username,
    avatarColor: p.avatarColor,
    avatarUrl: p.avatarUrl,
    isHost: p.isHost,
    isReady: p.isReady,
    connected: p.connected,
    isSpectator: p.isSpectator,
    muted: p.muted,
    score: p.score,
  };
}

export function toRoomState(room: LiveRoom): RoomState {
  const sortedPlayers = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  const sortedSpectators = Array.from(room.spectators.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      ownerId: room.ownerId,
      status: room.status,
      gameType: room.gameType,
      vibe: room.vibe,
      isPrivate: room.isPrivate,
      hasPassword: room.passwordHash !== null,
      maxPlayers: room.maxPlayers,
      createdAt: new Date(room.createdAt).toISOString(),
    },
    players: sortedPlayers.map(toPlayerPublic),
    spectators: sortedSpectators.map(toPlayerPublic),
  };
}

export function emitToRoom<T>(room: LiveRoom, event: string, payload: T): void {
  ioRef?.to(roomName(room.id)).emit(event, payload);
}

export function emitToUser<T>(userId: string, event: string, payload: T): void {
  ioRef?.to(`user:${userId}`).emit(event, payload);
}

export function joinSocketToRoom(socket: Socket, room: LiveRoom): void {
  void socket.join(roomName(room.id));
}

export function joinSocketToUserRoom(socket: Socket, userId: string): void {
  void socket.join(`user:${userId}`);
}

export function leaveSocketRoom(socket: Socket, room: LiveRoom): void {
  void socket.leave(roomName(room.id));
}

export interface RoomListEntry {
  id: string;
  code: string;
  name: string;
  status: string;
  gameType: string | null;
  playerCount: number;
  ownerId: string;
  createdAt: string;
}
