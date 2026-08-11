import type { GameType } from '../types';
import type { LiveRoom } from '../socket/store';

export interface GameAction {
  type: string;
  payload?: unknown;
}

export interface GameHandleActionResult {
  ok: boolean;
  error?: string;
}

export interface GamePlayerResult {
  userId: string;
  score: number;
}

export interface GameHighlight {
  key: string;
  emoji: string;
  title: string;
  userId?: string;
  detail?: string;
}

export interface GameDefinition {
  type: GameType;
  label: string;
  description: string;
  icon: string;
  minPlayers: number;
  maxPlayers: number | null;
  isPlayable: (room: LiveRoom) => boolean;
  snapshot: (room: LiveRoom) => unknown;
  /** Optional per-user snapshot for games with hidden information. */
  personalSnapshot?: (room: LiveRoom, userId: string) => unknown;
  /** Optional funny per-game stats used to generate awards. */
  highlights?: (room: LiveRoom) => GameHighlight[];
  start: (room: LiveRoom) => void;
  handleAction: (room: LiveRoom, userId: string, action: GameAction) => GameHandleActionResult;
  stop: (room: LiveRoom) => void;
  restart: (room: LiveRoom) => void;
  /** Final per-player scores used for results, XP and game history. */
  results: (room: LiveRoom) => GamePlayerResult[];
}
