import type { LiveRoom } from '../socket/store';
import type { GameDefinition, GameHighlight } from '../games/types';
import type { GameResultEntry } from '../types';

export interface GameAward {
  key: string;
  emoji: string;
  title: string;
  userId?: string;
  detail?: string;
}

export function collectHighlights(def: GameDefinition, room: LiveRoom): GameHighlight[] {
  if (def.highlights) {
    try {
      return def.highlights(room);
    } catch (err) {
      console.error('[partyverse] highlight generation failed', err);
    }
  }
  return [];
}

function usernameFor(userId: string, results: GameResultEntry[]): string | undefined {
  return results.find((r) => r.userId === userId)?.username;
}

export function generateAwards(
  _def: GameDefinition,
  _room: LiveRoom,
  results: GameResultEntry[],
  highlights: GameHighlight[],
): GameAward[] {
  const awards: GameAward[] = [];
  const byUser = new Map<string, GameResultEntry>();
  for (const r of results) byUser.set(r.userId, r);

  const winner = results.find((r) => r.placed === 1);
  if (winner) {
    awards.push({
      key: 'winner',
      emoji: '🏆',
      title: 'Game MVP',
      userId: winner.userId,
      detail: `${usernameFor(winner.userId, results) ?? 'Winner'} took the crown.`,
    });
  }

  for (const h of highlights) {
    const entry = h.userId ? byUser.get(h.userId) : undefined;
    const name = entry ? usernameFor(entry.userId, results) : undefined;
    awards.push({
      key: h.key,
      emoji: h.emoji,
      title: h.title,
      userId: h.userId,
      detail: h.detail ?? (name ? `${name} earned bragging rights.` : undefined),
    });
  }

  if (results.length > 2) {
    const last = results[results.length - 1];
    if (last && last.placed === results.length) {
      awards.push({
        key: 'last-place',
        emoji: '🐌',
        title: 'Last But Loudest',
        userId: last.userId,
        detail: `${usernameFor(last.userId, results) ?? 'Someone'} finished last — but had the most fun.`,
      });
    }
  }

  const winnerCount = results.filter((r) => r.placed === 1).length;
  if (winnerCount > 1) {
    awards.push({
      key: 'shared-glory',
      emoji: '🤝',
      title: 'Shared Glory',
      detail: 'The top spot was too hot for one player.',
    });
  }

  if (awards.length === 0) {
    awards.push({ key: 'participation', emoji: '🎉', title: 'Every Party Needs Players', detail: 'GG, thanks for playing!' });
  }
  return awards.slice(0, 6);
}
