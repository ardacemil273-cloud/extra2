import type { Socket } from 'socket.io';

export type GameType = 'quiz' | 'reaction' | 'rps' | 'draw' | 'telephone' | 'sabotaj' | 'chameleon' | 'reveal';

export type RoomVibe = 'friends' | 'spice' | 'chaos' | 'mixed';

export interface RoomStatus {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'lobby' | 'playing' | 'finished';
  gameType: GameType | null;
  vibe: RoomVibe;
  isPrivate: boolean;
  hasPassword: boolean;
  maxPlayers: number | null;
  createdAt: string;
}

export interface PlayerPublic {
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
}

export interface RoomState {
  room: RoomStatus;
  players: PlayerPublic[];
  spectators: PlayerPublic[];
}

export interface ChatMessagePublic {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  text: string;
  createdAt: string;
}

export interface ReactionPublic {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  emoji: string;
  createdAt: string;
}

export interface GameResultEntry {
  userId: string;
  username: string;
  avatarColor: string;
  score: number;
  placed: number;
}

export interface GamePlayerResult extends GameResultEntry {
  xpGained: number;
  seasonXpGained: number;
  levelBefore: number;
  levelAfter: number;
  newAchievements: string[];
  newTitle?: string | null;
}

export interface SocketUser {
  userId: string;
  username: string;
}

export interface AuthedSocket extends Socket {
  data: {
    user: SocketUser;
    roomId?: string;
    isSpectator?: boolean;
  };
}
