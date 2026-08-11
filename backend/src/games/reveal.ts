import type { LiveRoom } from '../socket/store';
import { schedule } from '../socket/store';
import { broadcastGameState } from './core';
import type { GameDefinition, GameAction } from './types';
import { censor } from '../utils/profanity';

type Vibe = 'friends' | 'spice' | 'chaos' | 'mixed';

interface RevealPlayerEntry {
  score: number;
  answer: string | null;
  vote: string | null;
  roundWins: number;
}

export interface RevealState {
  phase: 'countdown' | 'question' | 'vote' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  deck: Vibe;
  question: { text: string; vibe: string } | null;
  players: Record<string, RevealPlayerEntry>;
  order: string[];
  timerMs: number;
  roundEndAt: number;
  votesByTarget: Record<string, string[]> | null;
  winnerIds: string[] | null;
  usedQuestionIds: string[];
}

const COUNTDOWN_MS = 3000;
const QUESTION_MS = 45000;
const VOTE_MS = 30000;
const REVEAL_MS = 8000;
const TOTAL_ROUNDS = 6;
const MAX_ANSWER_LEN = 160;

const FRIENDS_DECK = [
  "What's the most embarrassing thing you've ever done in public?",
  'If you could have dinner with anyone alive or dead, who would it be?',
  "What's your most irrational fear?",
  "What's the best compliment you've ever received?",
  'What song do you sing at the top of your lungs in the shower?',
  "What's a skill you desperately wish you had?",
  "What's the weirdest food combo you secretly love?",
  "What was your childhood dream job?",
  "What's the last thing that made you laugh until you cried?",
  "What's your happy place?",
  "What's something you're irrationally good at?",
  'If you could instantly master one instrument, what would it be?',
];

const SPICE_DECK = [
  "What's the most attractive quality in a person?",
  'Would you rather date someone who makes you laugh or someone rich?',
  "What's your biggest green flag in a partner?",
  "What's a deal-breaker on a first date?",
  'Who in this room do you trust with your deepest secret?',
  "What's the smoothest pickup line you've ever used?",
  "What's the most romantic thing someone has ever done for you?",
  'Describe your perfect date in three words.',
  "What's your type, honestly?",
  'Who in this room would survive a zombie apocalypse best?',
  "What's a subtle sign someone's into you?",
  'Would you rather be flirted with for a whole party or never be noticed?',
];

const CHAOS_DECK = [
  'Would you rather fight 100 duck-sized horses or one horse-sized duck?',
  'Would you rather always say what you think or never speak again?',
  'Would you rather have unlimited money or unlimited free time?',
  'Would you rather lose all your memories or never make new ones?',
  'Would you rather be invisible or able to fly?',
  'Would you rather only eat sweet food or only salty food forever?',
  'Would you rather be famous for a great reason or infamous for a dumb one?',
  'Would you rather never use social media again or never touch your phone?',
  'Would you rather always be 10 minutes late or always 10 minutes early?',
  'Would you rather have a rewind button or a pause button for your life?',
  'Would you rather sneeze glitter for a year or have hiccups forever?',
  'Would you rather know how you die or when you die?',
];

const ALL_DECK = [...FRIENDS_DECK, ...SPICE_DECK, ...CHAOS_DECK];

const DECK_LABELS: Record<Vibe, string> = {
  friends: 'Vibe Check',
  spice: 'Spice It Up',
  chaos: 'Chaos Mode',
  mixed: 'Anything Goes',
};

function deckFor(room: LiveRoom): Vibe {
  const vibe = (room as LiveRoom & { vibe?: string }).vibe;
  if (vibe === 'friends' || vibe === 'spice' || vibe === 'chaos' || vibe === 'mixed') return vibe as Vibe;
  return 'mixed';
}

function initialState(room: LiveRoom): RevealState {
  const order: string[] = [];
  const players: Record<string, RevealPlayerEntry> = {};
  for (const [userId] of room.players) {
    order.push(userId);
    players[userId] = { score: 0, answer: null, vote: null, roundWins: 0 };
  }
  return {
    phase: 'countdown',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    deck: deckFor(room),
    question: null,
    players,
    order,
    timerMs: QUESTION_MS,
    roundEndAt: 0,
    votesByTarget: null,
    winnerIds: null,
    usedQuestionIds: [],
  };
}

function pickQuestion(state: RevealState): { text: string; vibe: string } | null {
  const pool = state.deck === 'mixed' ? ALL_DECK : state.deck === 'friends' ? FRIENDS_DECK : state.deck === 'spice' ? SPICE_DECK : CHAOS_DECK;
  const available = pool.filter((_, i) => !state.usedQuestionIds.includes(`${state.deck}-${i}`));
  if (available.length === 0) return null;
  const all = state.deck === 'mixed' ? ALL_DECK : pool;
  const idx = all.indexOf(available[Math.floor(Math.random() * available.length)]);
  state.usedQuestionIds.push(`${state.deck}-${idx}`);
  return { text: available[Math.floor(Math.random() * available.length)], vibe: DECK_LABELS[state.deck] };
}

function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as RevealState;
  const players: Record<string, { score: number; answer: string | null; hasAnswered: boolean }> = {};
  for (const userId of state.order) {
    const p = state.players[userId];
    players[userId] = {
      score: p.score,
      answer: state.phase === 'question' ? null : p.answer,
      hasAnswered: p.answer !== null,
    };
  }
  return {
    type: 'reveal',
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    deck: state.deck,
    deckLabel: DECK_LABELS[state.deck],
    question: state.question,
    players,
    order: state.order,
    timerMs: state.timerMs,
    roundEndAt: state.roundEndAt,
    votesByTarget: state.phase === 'reveal' || state.phase === 'finished' ? state.votesByTarget : null,
    winnerIds: state.phase === 'reveal' || state.phase === 'finished' ? state.winnerIds : null,
  };
}

function personalSnapshot(room: LiveRoom, userId: string): unknown {
  const state = room.gameState as RevealState;
  const base = publicSnapshot(room) as Record<string, unknown>;
  return {
    ...base,
    me: {
      answer: state.players[userId]?.answer ?? null,
      vote: state.players[userId]?.vote ?? null,
    },
  };
}

function startRound(room: LiveRoom): void {
  const state = room.gameState as RevealState;
  if (state.round >= state.totalRounds) {
    finishGame(room);
    return;
  }
  state.round += 1;
  const question = pickQuestion(state);
  if (!question) {
    finishGame(room);
    return;
  }
  state.question = question;
  state.phase = 'question';
  state.timerMs = QUESTION_MS;
  state.roundEndAt = Date.now() + QUESTION_MS;
  for (const userId of state.order) {
    state.players[userId].answer = null;
    state.players[userId].vote = null;
  }
  state.votesByTarget = null;
  state.winnerIds = null;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'question') {
        beginVote(room);
      }
    },
    QUESTION_MS,
  );
}

function beginVote(room: LiveRoom): void {
  const state = room.gameState as RevealState;
  if (state.phase !== 'question') return;
  state.phase = 'vote';
  state.timerMs = VOTE_MS;
  state.roundEndAt = Date.now() + VOTE_MS;
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
  const state = room.gameState as RevealState;
  if (state.phase !== 'vote') return;
  const counts: Record<string, string[]> = {};
  for (const voter of state.order) {
    const target = state.players[voter].vote;
    if (!target || target === voter) continue;
    (counts[target] ??= []).push(voter);
  }
  let max = 0;
  for (const voters of Object.values(counts)) {
    if (voters.length > max) max = voters.length;
  }
  const winners = Object.entries(counts)
    .filter(([, voters]) => voters.length === max && max > 0)
    .map(([id]) => id);
  state.winnerIds = winners;
  state.votesByTarget = counts;
  for (const id of winners) {
    state.players[id].score += 100;
    state.players[id].roundWins += 1;
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
  const state = room.gameState as RevealState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcastGameState(room);
}

export const revealGame: GameDefinition = {
  type: 'reveal',
  label: 'Reveal',
  description: 'Answer hilarious, spicy or deep questions and let the room crown the funniest answer. Vibe decides the deck!',
  icon: '💬',
  minPlayers: 2,
  maxPlayers: null,
  isPlayable: (room) => room.players.size >= 2,
  snapshot: (room) => publicSnapshot(room),
  personalSnapshot: (room, userId) => personalSnapshot(room, userId),
  start(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as RevealState).phase === 'countdown') {
          startRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action: GameAction) {
    const state = room.gameState as RevealState;
    if (action.type === 'submit') {
      if (state.phase !== 'question') return { ok: false, error: 'not-question-phase' };
      const p = state.players[userId];
      if (!p || p.answer !== null) return { ok: false, error: 'already-submitted' };
      const text = (action.payload as { text?: unknown } | undefined)?.text;
      if (typeof text !== 'string' || text.trim().length < 1) return { ok: false, error: 'invalid-answer' };
      const clean = censor(text.trim());
      if (clean.length < 1 || clean.length > MAX_ANSWER_LEN) return { ok: false, error: 'invalid-answer' };
      p.answer = clean;
      const allAnswered = state.order.every((id) => state.players[id].answer !== null);
      broadcastGameState(room);
      if (allAnswered) beginVote(room);
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
      if (state.players[targetId].answer === null) return { ok: false, error: 'invalid-target' };
      p.vote = targetId;
      const allVoted = state.order.every((id) => state.players[id].vote !== null);
      broadcastGameState(room);
      if (allVoted) resolveVote(room);
      return { ok: true };
    }
    return { ok: false, error: 'unknown-action' };
  },
  stop(room) {
    const state = room.gameState as RevealState;
    if (state) state.phase = 'finished';
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as RevealState).phase === 'countdown') {
          startRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as RevealState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].score }));
  },
  highlights(room) {
    const state = room.gameState as RevealState;
    const highlights: { key: string; emoji: string; title: string; userId?: string; detail?: string }[] = [];
    let funniest: { id: string; n: number } | null = null;
    for (const id of state.order) {
      const p = state.players[id];
      if (!funniest || p.roundWins > funniest.n) funniest = { id, n: p.roundWins };
    }
    if (funniest && funniest.n > 0) {
      highlights.push({
        key: 'funniest-in-room',
        emoji: '😂',
        title: 'Funniest in the Room',
        userId: funniest.id,
        detail: `Won ${funniest.n} round${funniest.n === 1 ? '' : 's'} by popular vote.`,
      });
    }
    let wordiest: { id: string; len: number } | null = null;
    for (const id of state.order) {
      const p = state.players[id];
      if (p.answer) {
        const len = p.answer.length;
        if (!wordiest || len > wordiest.len) wordiest = { id, len };
      }
    }
    if (wordiest && wordiest.len > 0) {
      highlights.push({
        key: 'wordiest',
        emoji: '📚',
        title: 'Professional Overthinker',
        userId: wordiest.id,
        detail: `Wrote a ${wordiest.len}-char answer. We said short answers, champ.`,
      });
    }
    return highlights;
  },
};
