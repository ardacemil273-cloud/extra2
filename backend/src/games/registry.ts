import type { GameType } from '../types';
import type { LiveRoom } from '../socket/store';
import type { GameDefinition } from './types';
import { quizGame } from './quiz';
import { reactionGame } from './reaction';
import { rpsGame } from './rps';
import { drawGame } from './draw';
import { telephoneGame } from './telephone';
import { sabotajGame } from './sabotaj';
import { chameleonGame } from './chameleon';
import { revealGame } from './reveal';

export const GAME_DEFINITIONS: GameDefinition[] = [
  quizGame,
  reactionGame,
  rpsGame,
  drawGame,
  telephoneGame,
  sabotajGame,
  chameleonGame,
  revealGame,
];

export const gamesById = new Map<string, GameDefinition>(
  GAME_DEFINITIONS.map((g) => [g.type, g]),
);

export function getGame(type: string | null | undefined): GameDefinition | null {
  if (!type) return null;
  return gamesById.get(type) ?? null;
}

export function getGameSnapshot(room: LiveRoom): unknown {
  const def = getGame(room.gameType);
  if (!def || !room.gameState) return null;
  return def.snapshot(room);
}

export function gameMetaList(): { type: GameType; label: string; description: string; icon: string; minPlayers: number; maxPlayers: number | null }[] {
  return GAME_DEFINITIONS.map((g) => ({
    type: g.type,
    label: g.label,
    description: g.description,
    icon: g.icon,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
  }));
}
