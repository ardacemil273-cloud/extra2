import type { LiveRoom } from '../socket/store';
import { emitToRoom, schedule, clearTimers } from '../socket/store';
import type { GameDefinition } from './types';

export type RpsChoice = 'rock' | 'paper' | 'scissors';

interface RpsPlayerEntry {
  score: number;
  wins: number;
  ties: number;
  currentChoice: RpsChoice | null;
}

export interface RpsState {
  phase: 'round' | 'reveal' | 'finished';
  round: number;
  targetScore: number;
  players: Record<string, RpsPlayerEntry>;
  order: string[];
  outcomes: Record<string, { wins: string[]; loses: string[]; ties: string[] }>;
  roundWinnerIds: string[];
  roundTimeoutMs: number;
}

const TARGET_SCORE = 5;
const ROUND_TIMEOUT_MS = 15000;
const REVEAL_MS = 3500;

const BEATS: Record<RpsChoice, RpsChoice> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

function initialState(room: LiveRoom): RpsState {
  const players: Record<string, RpsPlayerEntry> = {};
  const order: string[] = [];
  for (const [userId] of room.players) {
    players[userId] = { score: 0, wins: 0, ties: 0, currentChoice: null };
    order.push(userId);
  }
  return {
    phase: 'round',
    round: 1,
    targetScore: TARGET_SCORE,
    players,
    order,
    outcomes: {},
    roundWinnerIds: [],
    roundTimeoutMs: ROUND_TIMEOUT_MS,
  };
}

function broadcast(room: LiveRoom): void {
  emitToRoom(room, 'game:state', publicSnapshot(room));
}

export function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as RpsState;
  const revealChoices = state.phase === 'reveal' || state.phase === 'finished';
  const players: Record<string, { score: number; wins: number; ties: number; currentChoice: RpsChoice | null }> = {};
  for (const userId of state.order) {
    const p = state.players[userId];
    players[userId] = {
      score: p.score,
      wins: p.wins,
      ties: p.ties,
      currentChoice: revealChoices ? p.currentChoice : null,
    };
  }
  return {
    type: 'rps',
    phase: state.phase,
    round: state.round,
    targetScore: state.targetScore,
    players,
    order: state.order,
    outcomes: revealChoices ? state.outcomes : null,
    roundWinnerIds: state.roundWinnerIds,
    roundTimeoutMs: state.roundTimeoutMs,
  };
}

function resolveRound(room: LiveRoom): void {
  const state = room.gameState as RpsState;
  if (state.phase !== 'round') return;
  state.phase = 'reveal';
  state.outcomes = {};
  for (const userId of state.order) {
    state.outcomes[userId] = { wins: [], loses: [], ties: [] };
  }
  for (let i = 0; i < state.order.length; i++) {
    for (let j = i + 1; j < state.order.length; j++) {
      const a = state.order[i];
      const b = state.order[j];
      const choiceA = state.players[a].currentChoice;
      const choiceB = state.players[b].currentChoice;
      if (choiceA === null && choiceB === null) {
        state.outcomes[a].ties.push(b);
        state.outcomes[b].ties.push(a);
        continue;
      }
      if (choiceA === null) {
        state.outcomes[b].wins.push(a);
        state.outcomes[a].loses.push(b);
        continue;
      }
      if (choiceB === null) {
        state.outcomes[a].wins.push(b);
        state.outcomes[b].loses.push(a);
        continue;
      }
      if (choiceA === choiceB) {
        state.outcomes[a].ties.push(b);
        state.outcomes[b].ties.push(a);
      } else if (BEATS[choiceA] === choiceB) {
        state.outcomes[a].wins.push(b);
        state.outcomes[b].loses.push(a);
      } else {
        state.outcomes[b].wins.push(a);
        state.outcomes[a].loses.push(b);
      }
    }
  }
  const roundWinnerIds: string[] = [];
  let finished = false;
  for (const userId of state.order) {
    const entry = state.players[userId];
    const wins = state.outcomes[userId].wins.length;
    entry.wins += wins;
    entry.ties += state.outcomes[userId].ties.length;
    entry.score += wins;
    if (wins === state.order.length - 1) {
      roundWinnerIds.push(userId);
    }
    if (entry.score >= state.targetScore) {
      finished = true;
    }
  }
  state.roundWinnerIds = roundWinnerIds;
  if (finished) {
    state.phase = 'finished';
    room.status = 'finished';
    room.onFinished?.();
    broadcast(room);
    return;
  }
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'reveal') {
        beginRound(room);
      }
    },
    REVEAL_MS,
  );
}

function beginRound(room: LiveRoom): void {
  const state = room.gameState as RpsState;
  state.phase = 'round';
  state.round += 1;
  state.outcomes = {};
  state.roundWinnerIds = [];
  for (const userId of state.order) {
    state.players[userId].currentChoice = null;
  }
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'round') {
        resolveRound(room);
      }
    },
    ROUND_TIMEOUT_MS,
  );
}

export const rpsGame: GameDefinition = {
  type: 'rps',
  label: 'RPS Battle Royale',
  description: 'Every player picks rock, paper or scissors. Beat everyone to take the crown!',
  icon: 'hand',
  minPlayers: 2,
  maxPlayers: null,
  isPlayable: (room) => room.players.size >= 2,
  snapshot: (room) => publicSnapshot(room),
  start(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcast(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as RpsState).phase === 'round') {
          resolveRound(room);
        }
      },
      ROUND_TIMEOUT_MS,
    );
  },
  handleAction(room, userId, action) {
    if (action.type !== 'choose') {
      return { ok: false, error: 'unknown-action' };
    }
    const choice = (action.payload as { choice?: unknown } | undefined)?.choice;
    if (choice !== 'rock' && choice !== 'paper' && choice !== 'scissors') {
      return { ok: false, error: 'invalid-choice' };
    }
    const state = room.gameState as RpsState;
    if (state.phase !== 'round') {
      return { ok: false, error: 'not-choice-phase' };
    }
    const entry = state.players[userId];
    if (!entry) {
      return { ok: false, error: 'not-in-game' };
    }
    if (entry.currentChoice !== null) {
      return { ok: false, error: 'already-chosen' };
    }
    entry.currentChoice = choice as RpsChoice;
    const allChosen = state.order.every((id) => state.players[id].currentChoice !== null);
    if (allChosen) {
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
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as RpsState).phase === 'round') {
          resolveRound(room);
        }
      },
      ROUND_TIMEOUT_MS,
    );
  },
  results(room) {
    const state = room.gameState as RpsState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].score }));
  },
  highlights(room) {
    const state = room.gameState as RpsState;
    const beatdown = state.order.reduce<{ id: string; wins: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.wins > acc.wins) return { id, wins: p.wins };
      return acc;
    }, null);
    const tieTitan = state.order.reduce<{ id: string; ties: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.ties > acc.ties) return { id, ties: p.ties };
      return acc;
    }, null);
    return [
      ...(beatdown && beatdown.wins > 0
        ? [{ key: 'beatdown', emoji: '👊', title: 'Beatdown Artist', userId: beatdown.id, detail: `${beatdown.wins} head-to-head wins.` }]
        : []),
      ...(tieTitan && tieTitan.ties > 0
        ? [{ key: 'tie-titan', emoji: '🤝', title: 'Tie Titan', userId: tieTitan.id, detail: `${tieTitan.ties} psychic ties.` }]
        : []),
    ];
  },
};
