import type { LiveRoom } from '../socket/store';
import { schedule } from '../socket/store';
import { broadcastGameState } from './core';
import type { GameDefinition, GameAction } from './types';

type Role = 'crew' | 'saboteur';

interface Station {
  progress: number;
  fixed: boolean;
  sabotaged: boolean;
}

interface SabotajPlayerEntry {
  role: Role | null;
  choice: number | null;
  voted: boolean;
  voteTarget: string | null;
  ejected: boolean;
  fixedCount: number;
}

export interface SabotajState {
  phase: 'countdown' | 'action' | 'result' | 'discussion' | 'vote' | 'voteResult' | 'finished';
  round: number;
  maxRounds: number;
  stations: Station[];
  players: Record<string, SabotajPlayerEntry>;
  order: string[];
  fixedCount: number;
  sabotageCount: number;
  ejectedId: string | null;
  ejectedRole: Role | null;
  winner: Role | null;
  roundEndAt: number;
  timerMs: number;
}

const STATIONS = 5;
const FIX_TARGET = 3;
const MAX_SABOTAGES = 3;
const ACTION_MS = 25000;
const RESULT_MS = 8000;
const DISCUSSION_MS = 15000;
const VOTE_MS = 25000;
const VOTE_RESULT_MS = 10000;
const COUNTDOWN_MS = 3000;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function initialState(room: LiveRoom): SabotajState {
  const order: string[] = [];
  const players: Record<string, SabotajPlayerEntry> = {};
  for (const [userId] of room.players) {
    order.push(userId);
    players[userId] = { role: null, choice: null, voted: false, voteTarget: null, ejected: false, fixedCount: 0 };
  }
  const shuffled = shuffle(order);
  const saboteurCount = order.length >= 7 ? 2 : 1;
  for (let i = 0; i < saboteurCount; i++) {
    players[shuffled[i]].role = 'saboteur';
  }
  for (const userId of order) {
    if (!players[userId].role) players[userId].role = 'crew';
  }
  return {
    phase: 'countdown',
    round: 0,
    maxRounds: 5,
    stations: Array.from({ length: STATIONS }, () => ({ progress: 0, fixed: false, sabotaged: false })),
    players,
    order,
    fixedCount: 0,
    sabotageCount: 0,
    ejectedId: null,
    ejectedRole: null,
    winner: null,
    roundEndAt: 0,
    timerMs: ACTION_MS,
  };
}

function activePlayers(state: SabotajState): string[] {
  return state.order.filter((id) => !state.players[id].ejected);
}

function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as SabotajState;
  const players: Record<string, { submitted: boolean; voted: boolean; ejected: boolean; role: Role | null }> = {};
  for (const userId of state.order) {
    const p = state.players[userId];
    players[userId] = {
      submitted: p.choice !== null,
      voted: p.voted,
      ejected: p.ejected,
      role: p.ejected ? p.role : null,
    };
  }
  return {
    type: 'sabotaj',
    phase: state.phase,
    round: state.round,
    maxRounds: state.maxRounds,
    stations: state.stations.map((s) => ({ progress: s.progress, fixed: s.fixed, sabotaged: s.sabotaged })),
    players,
    order: state.order,
    fixedCount: state.fixedCount,
    sabotageCount: state.sabotageCount,
    stationTarget: FIX_TARGET,
    sabotageTarget: MAX_SABOTAGES,
    ejectedId: state.ejectedId,
    ejectedRole: state.ejectedRole,
    winner: state.winner,
    roundEndAt: state.roundEndAt,
    timerMs: state.timerMs,
  };
}

function personalSnapshot(room: LiveRoom, userId: string): unknown {
  const state = room.gameState as SabotajState;
  const base = publicSnapshot(room) as Record<string, unknown>;
  const me = state.players[userId];
  return {
    ...base,
    me: {
      role: me?.role ?? null,
      choice: me?.choice ?? null,
      voteTarget: me?.voteTarget ?? null,
      ejected: me?.ejected ?? false,
    },
  };
}

function beginRound(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  if (state.round >= state.maxRounds) {
    // Out of rounds: saboteur wins unless crew fixed everything
    state.winner = state.fixedCount >= FIX_TARGET ? 'crew' : 'saboteur';
    finishGame(room);
    return;
  }
  state.round += 1;
  state.phase = 'action';
  state.timerMs = ACTION_MS;
  state.roundEndAt = Date.now() + ACTION_MS;
  for (const userId of state.order) {
    const p = state.players[userId];
    if (!p.ejected) {
      p.choice = null;
      p.voted = false;
      p.voteTarget = null;
    }
  }
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'action') {
        resolveActions(room);
      }
    },
    ACTION_MS,
  );
}

function resolveActions(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  if (state.phase !== 'action') return;
  for (const station of state.stations) {
    station.sabotaged = false;
  }
  for (const userId of activePlayers(state)) {
    const p = state.players[userId];
    const station = p.choice;
    if (station === null || station < 0 || station >= state.stations.length) continue;
    const s = state.stations[station];
    if (p.role === 'saboteur') {
      if (s.progress > 0 || s.fixed) {
        s.sabotaged = true;
        s.progress = 0;
        s.fixed = false;
        state.sabotageCount += 1;
      }
    } else if (!s.fixed && s.progress < 2) {
      s.progress += 1;
      if (s.progress >= 2) {
        s.fixed = true;
        s.progress = 2;
        state.fixedCount += 1;
        p.fixedCount += 1;
      }
    }
  }
  state.phase = 'result';
  state.timerMs = RESULT_MS;
  state.roundEndAt = Date.now() + RESULT_MS;
  broadcastGameState(room);
  if (state.fixedCount >= FIX_TARGET) {
    state.winner = 'crew';
    schedule(room, () => finishGame(room), RESULT_MS);
    return;
  }
  if (state.sabotageCount >= MAX_SABOTAGES) {
    state.winner = 'saboteur';
    schedule(room, () => finishGame(room), RESULT_MS);
    return;
  }
  schedule(room, () => beginDiscussion(room), RESULT_MS);
}

function beginDiscussion(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  state.phase = 'discussion';
  state.timerMs = DISCUSSION_MS;
  state.roundEndAt = Date.now() + DISCUSSION_MS;
  broadcastGameState(room);
  schedule(room, () => beginVote(room), DISCUSSION_MS);
}

function beginVote(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  state.phase = 'vote';
  state.timerMs = VOTE_MS;
  state.roundEndAt = Date.now() + VOTE_MS;
  for (const userId of activePlayers(state)) {
    state.players[userId].voted = false;
    state.players[userId].voteTarget = null;
  }
  broadcastGameState(room);
  schedule(room, () => resolveVote(room), VOTE_MS);
}

function resolveVote(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  if (state.phase !== 'vote') return;
  const voters = activePlayers(state).filter((id) => state.players[id].voteTarget !== null);
  const counts: Record<string, number> = {};
  for (const id of voters) {
    const target = state.players[id].voteTarget!;
    if (state.players[target] && target !== id) {
      counts[target] = (counts[target] ?? 0) + 1;
    }
  }
  let ejectedId: string | null = null;
  let best = 0;
  let tie = false;
  for (const [id, count] of Object.entries(counts)) {
    if (count > best) {
      best = count;
      ejectedId = id;
      tie = false;
    } else if (count === best) {
      tie = true;
    }
  }
  if (tie) ejectedId = null;
  state.ejectedId = ejectedId;
  const ejectedRole = ejectedId ? state.players[ejectedId].role : null;
  state.ejectedRole = ejectedRole;
  if (ejectedId) {
    state.players[ejectedId].ejected = true;
  }
  state.phase = 'voteResult';
  state.timerMs = VOTE_RESULT_MS;
  state.roundEndAt = Date.now() + VOTE_RESULT_MS;
  broadcastGameState(room);
  if (ejectedId && ejectedRole === 'saboteur') {
    state.winner = 'crew';
    schedule(room, () => finishGame(room), VOTE_RESULT_MS);
    return;
  }
  if (ejectedId) {
    const crewLeft = activePlayers(state).filter((id) => state.players[id].role === 'crew').length;
    const saboteursLeft = activePlayers(state).filter((id) => state.players[id].role === 'saboteur').length;
    if (crewLeft <= 0) {
      state.winner = 'saboteur';
      schedule(room, () => finishGame(room), VOTE_RESULT_MS);
      return;
    }
    if (saboteursLeft === 0) {
      state.winner = 'crew';
      schedule(room, () => finishGame(room), VOTE_RESULT_MS);
      return;
    }
  }
  schedule(room, () => beginRound(room), VOTE_RESULT_MS);
}

function finishGame(room: LiveRoom): void {
  const state = room.gameState as SabotajState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcastGameState(room);
}

function scoreForPlayer(state: SabotajState, userId: string): number {
  const p = state.players[userId];
  if (state.winner === null) return 0;
  if (p.role === state.winner) {
    return state.winner === 'crew' ? 200 : 300;
  }
  return 50;
}

export const sabotajGame: GameDefinition = {
  type: 'sabotaj',
  label: 'Sabotaj',
  description: 'A saboteur hides among the crew. Fix the stations, or find the traitor — hidden roles!',
  icon: '🕵️',
  minPlayers: 3,
  maxPlayers: null,
  isPlayable: (room) => room.players.size >= 3,
  snapshot: (room) => publicSnapshot(room),
  personalSnapshot: (room, userId) => personalSnapshot(room, userId),
  start(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as SabotajState).phase === 'countdown') {
          beginRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action: GameAction) {
    const state = room.gameState as SabotajState;
    if (action.type === 'pick') {
      if (state.phase !== 'action') return { ok: false, error: 'not-action-phase' };
      const p = state.players[userId];
      if (!p || p.ejected) return { ok: false, error: 'not-active' };
      if (p.choice !== null) return { ok: false, error: 'already-picked' };
      const station = (action.payload as { station?: unknown } | undefined)?.station;
      if (typeof station !== 'number' || !Number.isInteger(station) || station < 0 || station >= state.stations.length) {
        return { ok: false, error: 'invalid-station' };
      }
      p.choice = station;
      const allPicked = activePlayers(state).every((id) => state.players[id].choice !== null);
      broadcastGameState(room);
      if (allPicked) resolveActions(room);
      return { ok: true };
    }
    if (action.type === 'vote') {
      if (state.phase !== 'vote') return { ok: false, error: 'not-vote-phase' };
      const p = state.players[userId];
      if (!p || p.ejected) return { ok: false, error: 'not-active' };
      if (p.voted) return { ok: false, error: 'already-voted' };
      const targetId = (action.payload as { targetId?: unknown } | undefined)?.targetId;
      if (typeof targetId !== 'string' || !state.players[targetId] || targetId === userId) {
        return { ok: false, error: 'invalid-target' };
      }
      if (state.players[targetId].ejected) return { ok: false, error: 'invalid-target' };
      p.voted = true;
      p.voteTarget = targetId;
      const allVoted = activePlayers(state).every((id) => state.players[id].voted);
      broadcastGameState(room);
      if (allVoted) resolveVote(room);
      return { ok: true };
    }
    return { ok: false, error: 'unknown-action' };
  },
  stop(room) {
    const state = room.gameState as SabotajState;
    if (state) state.phase = 'finished';
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as SabotajState).phase === 'countdown') {
          beginRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as SabotajState;
    return state.order.map((id) => ({ userId: id, score: scoreForPlayer(state, id) }));
  },
  highlights(room) {
    const state = room.gameState as SabotajState;
    const highlights: { key: string; emoji: string; title: string; userId?: string; detail?: string }[] = [];
    if (state.winner === 'crew') {
      const hero = state.order.reduce<{ id: string; n: number } | null>((acc, id) => {
        const p = state.players[id];
        if (!acc || p.fixedCount > acc.n) return { id, n: p.fixedCount };
        return acc;
      }, null);
      if (hero && hero.n > 0) {
        highlights.push({ key: 'crew-hero', emoji: '🦸', title: 'Crew Hero', userId: hero.id, detail: `Fixed ${hero.n} stations.` });
      }
    } else if (state.winner === 'saboteur') {
      const traitor = state.order.find((id) => state.players[id].role === 'saboteur');
      if (traitor) {
        highlights.push({ key: 'true-traitor', emoji: '🕵️', title: 'Perfect Crime', userId: traitor, detail: 'The saboteur walked away free.' });
      }
    }
    if (state.ejectedRole === 'saboteur' && state.ejectedId) {
      highlights.push({ key: 'saboteur-caught', emoji: '🚨', title: 'Caught Red-Handed', userId: state.ejectedId, detail: 'Ejected as the saboteur.' });
    }
    return highlights;
  },
};
