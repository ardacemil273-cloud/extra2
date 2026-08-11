import type { LiveRoom } from '../socket/store';
import { emitToRoom, emitToUser, schedule } from '../socket/store';
import type { GameDefinition, GameHighlight } from './types';
import type { GameResultEntry } from '../types';
import { awardGameRewards } from '../social/achievements';
import { collectHighlights, generateAwards, type GameAward } from '../social/awards';
import { getGame } from './registry';

export function getPublicSnapshot(room: LiveRoom): unknown {
  const def = getGame(room.gameType);
  if (!def || room.gameState === null) return null;
  return def.snapshot(room);
}

export function getPersonalSnapshot(room: LiveRoom, userId: string): unknown {
  const def = getGame(room.gameType);
  if (!def || room.gameState === null) return null;
  if (def.personalSnapshot) return def.personalSnapshot(room, userId);
  return def.snapshot(room);
}

export function broadcastGameState(room: LiveRoom): void {
  const def = getGame(room.gameType);
  if (!def || room.gameState === null) return;
  if (def.personalSnapshot) {
    for (const [userId] of room.players) {
      emitToUser(userId, 'game:state', def.personalSnapshot(room, userId));
    }
    for (const [spectatorId] of room.spectators) {
      emitToUser(spectatorId, 'game:state', def.snapshot(room));
    }
    return;
  }
  emitToRoom(room, 'game:state', def.snapshot(room));
}

export function clearGameTimers(room: LiveRoom): void {
  const def = getGame(room.gameType);
  if (def) def.stop(room);
}

export function finalizeGame(room: LiveRoom): void {
  const def = getGame(room.gameType);
  if (!def) return;
  const raw = def.results(room).filter((r) => room.players.has(r.userId));
  const sorted = [...raw].sort((a, b) => b.score - a.score);
  const results: GameResultEntry[] = [];
  let lastPlaced = 1;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const player = room.players.get(r.userId);
    const placed = i === 0 ? 1 : sorted[i - 1].score === r.score ? lastPlaced : i + 1;
    lastPlaced = placed;
    results.push({
      userId: r.userId,
      username: player?.username ?? r.userId,
      avatarColor: player?.avatarColor ?? '#7c3aed',
      score: r.score,
      placed,
    });
  }
  for (const [userId, player] of room.players) {
    const found = results.find((r) => r.userId === userId);
    player.score = found?.score ?? player.score;
  }
  const highlights = collectHighlights(def, room);
  const awards = generateAwards(def, room, results, highlights);
  void awardGameRewards(room, results, awards, highlights).catch((err) => {
    console.error('[partyverse] failed to persist game results', err);
  });
}

export function toAwardPublic(awards: GameAward[]): { key: string; emoji: string; title: string; userId?: string; detail?: string }[] {
  return awards.map((a) => ({
    key: a.key,
    emoji: a.emoji,
    title: a.title,
    userId: a.userId,
    detail: a.detail,
  }));
}

export type { GameAward, GameHighlight };

export function ensureMinPlayers(room: LiveRoom, def: GameDefinition): void {
  if (room.players.size >= def.minPlayers) return;
  const state = room.gameState as { phase?: string } | null;
  if (state && state.phase === 'finished') return;
  def.stop(room);
  room.gameState = null;
  room.status = 'lobby';
}

export function commonCountdown(room: LiveRoom, ms: number, onDone: () => void): void {
  schedule(room, () => {
    if (room.status === 'playing') onDone();
  }, ms);
}

export type { GameResultEntry };
