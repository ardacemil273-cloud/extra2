import type { LiveRoom } from '../socket/store';
import { schedule } from '../socket/store';
import { broadcastGameState } from './core';
import type { GameDefinition, GameAction } from './types';
import { censor } from '../utils/profanity';

interface ChameleonPlayerEntry {
  score: number;
  clue: string | null;
  vote: string | null;
  caughtRounds: number;
  escapedRounds: number;
  correctVotes: number;
  averageClueLen: number;
}

export interface ChameleonState {
  phase: 'countdown' | 'clue' | 'vote' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  category: string;
  word: string | null;
  chameleonId: string | null;
  clueOrder: string[];
  clueIndex: number;
  currentClueId: string | null;
  players: Record<string, ChameleonPlayerEntry>;
  order: string[];
  timerMs: number;
  roundEndAt: number;
  voteCount: number;
  votesByTarget: Record<string, string[]> | null;
  caught: boolean | null;
  prevChameleon: string | null;
}

const COUNTDOWN_MS = 3000;
const CLUE_MS = 25000;
const VOTE_MS = 30000;
const REVEAL_MS = 10000;
const TOTAL_ROUNDS = 4;
const MAX_CLUE_LEN = 40;

const WORD_BANK: Record<string, string[]> = {
  Animals: ['Giraffe', 'Penguin', 'Dolphin', 'Flamingo', 'Octopus', 'Koala', 'Panda', 'Platypus', 'Walrus', 'Meerkat'],
  Food: ['Pizza', 'Sushi', 'Burger', 'Waffle', 'Ramen', 'Taco', 'Croissant', 'Kimchi', 'Popcorn', 'Tiramisu'],
  Jobs: ['Firefighter', 'Astronaut', 'Barber', 'Chef', 'Pilot', 'Vet', 'Youtuber', 'Mime', 'Archaeologist', 'Referee'],
  Places: ['Beach', 'Museum', 'Airport', 'Library', 'Amusement Park', 'Desert', 'Lighthouse', 'Bakery', 'Gym', 'Roof'],
  Movies: ['Titanic', 'Shrek', 'Avatar', 'Jaws', 'Minions', 'Rocky', 'Coco', 'Jurassic Park', 'Aladdin', 'Joker'],
  Objects: ['Umbrella', 'Toaster', 'Slippers', 'Hammock', 'Microwave', 'Paperclip', 'Boomerang', 'Hourglass', 'Sunglasses', 'Dartboard'],
  Sports: ['Soccer', 'Darts', 'Sumo', 'Bowling', 'Bungee Jumping', 'Skateboarding', 'Cricket', 'Surfing', 'Fencing', 'Marathon'],
  Music: ['Guitar', 'Opera', 'Karaoke', 'Bass', 'Disco', 'Lullaby', 'Air Guitar', 'Triangle', 'DJ', 'Whistling'],
};

interface CategoryWord {
  category: string;
  word: string;
}

function pickWord(): CategoryWord {
  const categories = Object.keys(WORD_BANK);
  const category = categories[Math.floor(Math.random() * categories.length)];
  const words = WORD_BANK[category];
  return { category, word: words[Math.floor(Math.random() * words.length)] };
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function initialState(room: LiveRoom): ChameleonState {
  const order: string[] = [];
  const players: Record<string, ChameleonPlayerEntry> = {};
  for (const [userId] of room.players) {
    order.push(userId);
    players[userId] = {
      score: 0,
      clue: null,
      vote: null,
      caughtRounds: 0,
      escapedRounds: 0,
      correctVotes: 0,
      averageClueLen: 0,
    };
  }
  return {
    phase: 'countdown',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    category: '',
    word: null,
    chameleonId: null,
    clueOrder: [],
    clueIndex: 0,
    currentClueId: null,
    players,
    order,
    timerMs: CLUE_MS,
    roundEndAt: 0,
    voteCount: 0,
    votesByTarget: null,
    caught: null,
    prevChameleon: null,
  };
}

function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as ChameleonState;
  const players: Record<string, { score: number; clue: string | null }> = {};
  for (const userId of state.order) {
    const p = state.players[userId];
    players[userId] = { score: p.score, clue: p.clue };
  }
  return {
    type: 'chameleon',
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    category: state.category,
    word: null,
    chameleonId: null,
    clueOrder: state.phase === 'clue' ? state.clueOrder : null,
    clueIndex: state.clueIndex,
    currentClueId: state.phase === 'clue' ? state.currentClueId : null,
    players,
    order: state.order,
    timerMs: state.timerMs,
    roundEndAt: state.roundEndAt,
    votesByTarget: state.phase === 'reveal' || state.phase === 'finished' ? state.votesByTarget : null,
    caught: state.phase === 'reveal' || state.phase === 'finished' ? state.caught : null,
  };
}

function personalSnapshot(room: LiveRoom, userId: string): unknown {
  const state = room.gameState as ChameleonState;
  const base = publicSnapshot(room) as Record<string, unknown>;
  const isChameleon = state.chameleonId === userId;
  const showSecret =
    state.phase === 'clue' || state.phase === 'vote' || state.phase === 'reveal' || state.phase === 'finished';
  return {
    ...base,
    me: {
      isChameleon,
      word: showSecret && !isChameleon ? state.word : null,
      caught: state.phase === 'reveal' || state.phase === 'finished' ? state.caught : null,
      vote: state.players[userId]?.vote ?? null,
    },
  };
}

function startRound(room: LiveRoom): void {
  const state = room.gameState as ChameleonState;
  if (state.round >= state.totalRounds) {
    finishGame(room);
    return;
  }
  state.round += 1;
  const pick = pickWord();
  state.category = pick.category;
  state.word = pick.word;
  const candidates = state.order.filter((id) => id !== state.prevChameleon);
  const pool = candidates.length > 0 ? candidates : state.order;
  state.chameleonId = pool[Math.floor(Math.random() * pool.length)];
  state.prevChameleon = state.chameleonId;
  state.clueOrder = shuffle(state.order);
  state.clueIndex = 0;
  state.currentClueId = state.clueOrder[0];
  state.voteCount = 0;
  state.votesByTarget = null;
  state.caught = null;
  for (const userId of state.order) {
    state.players[userId].clue = null;
    state.players[userId].vote = null;
  }
  state.phase = 'clue';
  state.timerMs = CLUE_MS;
  state.roundEndAt = Date.now() + CLUE_MS;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'clue') {
        nextClue(room);
      }
    },
    CLUE_MS,
  );
}

function nextClue(room: LiveRoom): void {
  const state = room.gameState as ChameleonState;
  if (state.phase !== 'clue') return;
  if (state.clueIndex + 1 >= state.clueOrder.length) {
    beginVote(room);
    return;
  }
  state.clueIndex += 1;
  state.currentClueId = state.clueOrder[state.clueIndex];
  state.timerMs = CLUE_MS;
  state.roundEndAt = Date.now() + CLUE_MS;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'clue' && state.currentClueId === state.clueOrder[state.clueIndex]) {
        nextClue(room);
      }
    },
    CLUE_MS,
  );
}

function beginVote(room: LiveRoom): void {
  const state = room.gameState as ChameleonState;
  if (state.phase !== 'clue') return;
  state.phase = 'vote';
  state.timerMs = VOTE_MS;
  state.roundEndAt = Date.now() + VOTE_MS;
  for (const userId of state.order) {
    state.players[userId].vote = null;
  }
  state.voteCount = 0;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'vote') {
        resolveVote(room);
      }
    },
    VOTE_MS,
  );
}

function resolveVote(room: LiveRoom): void {
  const state = room.gameState as ChameleonState;
  if (state.phase !== 'vote') return;
  const counts: Record<string, string[]> = {};
  for (const voter of state.order) {
    const target = state.players[voter].vote;
    if (!target || target === voter) continue;
    (counts[target] ??= []).push(voter);
  }
  let top: string | null = null;
  let topCount = 0;
  let tie = false;
  for (const [target, voters] of Object.entries(counts)) {
    if (voters.length > topCount) {
      top = target;
      topCount = voters.length;
      tie = false;
    } else if (voters.length === topCount) {
      tie = true;
    }
  }
  const caught = top === state.chameleonId && !tie && state.chameleonId !== null;
  state.caught = caught;
  state.votesByTarget = counts;
  const chameleon = state.chameleonId ? state.players[state.chameleonId] : undefined;
  if (caught && state.chameleonId) {
    if (chameleon) {
      chameleon.score += 50;
      chameleon.caughtRounds += 1;
    }
    for (const voter of counts[state.chameleonId] ?? []) {
      state.players[voter].score += 100;
      state.players[voter].correctVotes += 1;
    }
    for (const userId of state.order) {
      const p = state.players[userId];
      if (p.vote !== state.chameleonId) p.score += 20;
    }
  } else {
    if (chameleon) {
      chameleon.score += 200;
      chameleon.escapedRounds += 1;
    }
    for (const userId of state.order) {
      if (userId !== state.chameleonId) state.players[userId].score += 10;
    }
  }
  state.phase = 'reveal';
  state.timerMs = REVEAL_MS;
  state.roundEndAt = Date.now() + REVEAL_MS;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'reveal') {
        startRound(room);
      }
    },
    REVEAL_MS,
  );
}

function finishGame(room: LiveRoom): void {
  const state = room.gameState as ChameleonState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcastGameState(room);
}

export const chameleonGame: GameDefinition = {
  type: 'chameleon',
  label: 'Chameleon',
  description: 'One player is the Chameleon who has no idea what the word is. Blend in, drop a clue, and sniff out the fake!',
  icon: '🦎',
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
        if (room.gameState && (room.gameState as ChameleonState).phase === 'countdown') {
          startRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action: GameAction) {
    const state = room.gameState as ChameleonState;
    if (action.type === 'clue') {
      if (state.phase !== 'clue') return { ok: false, error: 'not-clue-phase' };
      if (state.currentClueId !== userId) return { ok: false, error: 'not-your-turn' };
      const text = (action.payload as { text?: unknown } | undefined)?.text;
      if (typeof text !== 'string' || text.trim().length < 1) {
        return { ok: false, error: 'invalid-clue' };
      }
      const clean = censor(text.trim());
      if (clean.length < 1 || clean.length > MAX_CLUE_LEN) return { ok: false, error: 'invalid-clue' };
      state.players[userId].clue = clean;
      nextClue(room);
      return { ok: true };
    }
    if (action.type === 'vote') {
      if (state.phase !== 'vote') return { ok: false, error: 'not-vote-phase' };
      const p = state.players[userId];
      if (!p || p.vote !== null) return { ok: false, error: 'already-voted' };
      const targetId = (action.payload as { targetId?: unknown } | undefined)?.targetId;
      if (typeof targetId !== 'string' || !state.players[targetId] || targetId === userId) {
        return { ok: false, error: 'invalid-target' };
      }
      p.vote = targetId;
      state.voteCount += 1;
      const allVoted = state.order.every((id) => state.players[id].vote !== null);
      broadcastGameState(room);
      if (allVoted) resolveVote(room);
      return { ok: true };
    }
    return { ok: false, error: 'unknown-action' };
  },
  stop(room) {
    const state = room.gameState as ChameleonState;
    if (state) state.phase = 'finished';
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as ChameleonState).phase === 'countdown') {
          startRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as ChameleonState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].score }));
  },
  highlights(room) {
    const state = room.gameState as ChameleonState;
    const highlights: { key: string; emoji: string; title: string; userId?: string; detail?: string }[] = [];
    let bestDetective: { id: string; n: number } | null = null;
    for (const id of state.order) {
      const p = state.players[id];
      if (!bestDetective || p.correctVotes > bestDetective.n) bestDetective = { id, n: p.correctVotes };
    }
    if (bestDetective && bestDetective.n > 0) {
      highlights.push({
        key: 'chameleon-detective',
        emoji: '🔍',
        title: 'Chameleon Detective',
        userId: bestDetective.id,
        detail: `Caught the fake ${bestDetective.n} time${bestDetective.n === 1 ? '' : 's'}.`,
      });
    }
    let bestEscapee: { id: string; n: number } | null = null;
    for (const id of state.order) {
      const p = state.players[id];
      if (p.escapedRounds > 0 && (!bestEscapee || p.escapedRounds > bestEscapee.n)) {
        bestEscapee = { id, n: p.escapedRounds };
      }
    }
    if (bestEscapee) {
      highlights.push({
        key: 'master-disguise',
        emoji: '🎭',
        title: 'Master of Disguise',
        userId: bestEscapee.id,
        detail: `Blended in ${bestEscapee.n} time${bestEscapee.n === 1 ? '' : 's'}.`,
      });
    }
    let shortest: { id: string; len: number } | null = null;
    for (const id of state.order) {
      const p = state.players[id];
      if (p.clue) {
        const len = p.clue.length;
        if (!shortest || len < shortest.len) shortest = { id, len };
      }
    }
    if (shortest && shortest.len > 0) {
      highlights.push({
        key: 'clue-sharp',
        emoji: '🗡️',
        title: 'Sharpest Clue',
        userId: shortest.id,
        detail: `Dropped the shortest clue (${shortest.len} chars).`,
      });
    }
    return highlights;
  },
};
