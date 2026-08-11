import type { LiveRoom } from '../socket/store';
import { emitToRoom, schedule, clearTimers } from '../socket/store';
import type { GameDefinition } from './types';

interface ReactionPlayerEntry {
  wins: number;
  bestMs: number | null;
  playedRounds: number;
}

export interface ReactionState {
  phase: 'countdown' | 'awaiting' | 'result' | 'finished';
  round: number;
  totalRounds: number;
  signalAt: number | null;
  players: Record<string, ReactionPlayerEntry>;
  order: string[];
  roundTimes: Record<string, number | null>;
  roundWinner: string | null;
  responseWindowMs: number;
}

const TOTAL_ROUNDS = 5;
const COUNTDOWN_MIN_MS = 1500;
const COUNTDOWN_MAX_MS = 3500;
const RESULT_MS = 3000;
const RESPONSE_WINDOW_MS = 15000;

function initialState(room: LiveRoom): ReactionState {
  const players: Record<string, ReactionPlayerEntry> = {};
  const order: string[] = [];
  for (const [userId] of room.players) {
    players[userId] = { wins: 0, bestMs: null, playedRounds: 0 };
    order.push(userId);
  }
  return {
    phase: 'countdown',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    signalAt: null,
    players,
    order,
    roundTimes: {},
    roundWinner: null,
    responseWindowMs: RESPONSE_WINDOW_MS,
  };
}

function broadcast(room: LiveRoom): void {
  emitToRoom(room, 'game:state', publicSnapshot(room));
}

export function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as ReactionState;
  const revealTimes = state.phase === 'result' || state.phase === 'finished';
  return {
    type: 'reaction',
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    signalAt: state.phase === 'awaiting' ? state.signalAt : null,
    players: state.players,
    order: state.order,
    roundTimes: revealTimes ? state.roundTimes : null,
    roundWinner: state.roundWinner,
    responseWindowMs: state.responseWindowMs,
  };
}

function beginRound(room: LiveRoom): void {
  const state = room.gameState as ReactionState;
  if (state.round >= state.totalRounds) {
    finishGame(room);
    return;
  }
  state.round += 1;
  state.phase = 'awaiting';
  state.roundTimes = {};
  state.roundWinner = null;
  for (const userId of state.order) {
    state.roundTimes[userId] = null;
  }
  state.signalAt = Date.now();
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'awaiting') {
        resolveRound(room);
      }
    },
    RESPONSE_WINDOW_MS,
  );
}

function resolveRound(room: LiveRoom): void {
  const state = room.gameState as ReactionState;
  if (state.phase !== 'awaiting') return;
  state.phase = 'result';
  let fastest: { userId: string; ms: number } | null = null;
  for (const userId of state.order) {
    const ms = state.roundTimes[userId];
    if (ms === null || ms === undefined) continue;
    const entry = state.players[userId];
    entry.playedRounds += 1;
    if (entry.bestMs === null || ms < entry.bestMs) {
      entry.bestMs = ms;
    }
    if (fastest === null || ms < fastest.ms) {
      fastest = { userId, ms };
    }
  }
  if (fastest) {
    state.players[fastest.userId].wins += 1;
    state.roundWinner = fastest.userId;
  }
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'result') {
        beginRound(room);
      }
    },
    RESULT_MS,
  );
}

function finishGame(room: LiveRoom): void {
  const state = room.gameState as ReactionState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcast(room);
}

export const reactionGame: GameDefinition = {
  type: 'reaction',
  label: 'Fastest Finger',
  description: 'React to the signal as fast as you can. Fastest click wins the round!',
  icon: 'zap',
  minPlayers: 2,
  maxPlayers: null,
  isPlayable: (room) => room.players.size >= 2,
  snapshot: (room) => publicSnapshot(room),
  start(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcast(room);
    const delay = COUNTDOWN_MIN_MS + Math.floor(Math.random() * (COUNTDOWN_MAX_MS - COUNTDOWN_MIN_MS));
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as ReactionState).phase === 'countdown') {
          beginRound(room);
        }
      },
      delay,
    );
  },
  handleAction(room, userId, action) {
    if (action.type !== 'click') {
      return { ok: false, error: 'unknown-action' };
    }
    const state = room.gameState as ReactionState;
    if (state.phase !== 'awaiting' || state.signalAt === null) {
      return { ok: false, error: 'not-awaiting-phase' };
    }
    if (state.roundTimes[userId] !== null && state.roundTimes[userId] !== undefined) {
      return { ok: false, error: 'already-clicked' };
    }
    state.roundTimes[userId] = Date.now() - state.signalAt;
    const allClicked = state.order.every((id) => state.roundTimes[id] !== null);
    if (allClicked) {
      clearTimers(room);
      resolveRound(room);
      return { ok: true };
    }
    return { ok: true };
  },
  stop(room) {
    clearTimers(room);
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcast(room);
    const delay = COUNTDOWN_MIN_MS + Math.floor(Math.random() * (COUNTDOWN_MAX_MS - COUNTDOWN_MIN_MS));
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as ReactionState).phase === 'countdown') {
          beginRound(room);
        }
      },
      delay,
    );
  },
  results(room) {
    const state = room.gameState as ReactionState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].wins }));
  },
  highlights(room) {
    const state = room.gameState as ReactionState;
    const withTime = state.order.filter((id) => state.players[id].bestMs !== null);
    if (withTime.length === 0) return [];
    const fastest = withTime.reduce((a, b) =>
      (state.players[a].bestMs as number) < (state.players[b].bestMs as number) ? a : b,
    );
    const slowest = withTime.reduce((a, b) =>
      (state.players[a].bestMs as number) > (state.players[b].bestMs as number) ? a : b,
    );
    return [
      { key: 'human-flash', emoji: '⚡', title: 'Human Flash', userId: fastest, detail: `Fastest reaction: ${state.players[fastest].bestMs}ms.` },
      ...(slowest !== fastest
        ? [{ key: 'slowpoke', emoji: '🐌', title: 'Slowpoke', userId: slowest, detail: `Slowest reaction: ${state.players[slowest].bestMs}ms.` }]
        : []),
    ];
  },
};
