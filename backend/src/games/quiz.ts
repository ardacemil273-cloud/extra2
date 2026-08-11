import type { LiveRoom } from '../socket/store';
import { emitToRoom, schedule, clearTimers } from '../socket/store';
import type { GameDefinition } from './types';

interface QuizQuestion {
  id: string;
  category: string;
  text: string;
  options: string[];
  correctIndex: number;
}

interface QuizPlayerEntry {
  score: number;
  answeredIndex: number | null;
  answeredAt: number | null;
  streak: number;
  correct: number;
  maxStreak: number;
}

export interface QuizState {
  phase: 'countdown' | 'question' | 'reveal' | 'leaderboard' | 'finished';
  round: number;
  totalRounds: number;
  question: Omit<QuizQuestion, 'correctIndex'> | null;
  correctIndex: number | null;
  players: Record<string, QuizPlayerEntry>;
  order: string[];
  usedQuestionIds: string[];
  timePerQuestionMs: number;
  revealMs: number;
}

const QUESTION_BANK: QuizQuestion[] = [
  { id: 'q1', category: 'Science', text: 'What is the chemical symbol for gold?', options: ['Au', 'Ag', 'Go', 'Gd'], correctIndex: 0 },
  { id: 'q2', category: 'Science', text: 'How many planets are in our solar system?', options: ['7', '8', '9', '10'], correctIndex: 1 },
  { id: 'q3', category: 'Science', text: 'What gas do plants absorb from the atmosphere?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 2 },
  { id: 'q4', category: 'Science', text: 'What is the hardest natural substance on Earth?', options: ['Gold', 'Iron', 'Diamond', 'Quartz'], correctIndex: 2 },
  { id: 'q5', category: 'Science', text: 'What is the closest planet to the Sun?', options: ['Venus', 'Mercury', 'Mars', 'Earth'], correctIndex: 1 },
  { id: 'q6', category: 'Science', text: 'How many hearts does an octopus have?', options: ['1', '2', '3', '4'], correctIndex: 2 },
  { id: 'q7', category: 'Science', text: 'What is the speed of light approximately?', options: ['300,000 km/s', '150,000 km/s', '1,000,000 km/s', '30,000 km/s'], correctIndex: 0 },
  { id: 'q8', category: 'Science', text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Jupiter', 'Saturn', 'Mars'], correctIndex: 3 },
  { id: 'q9', category: 'Science', text: 'What force keeps us on the ground?', options: ['Magnetism', 'Gravity', 'Friction', 'Inertia'], correctIndex: 1 },
  { id: 'q10', category: 'Science', text: 'What is the most abundant gas in Earth’s atmosphere?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], correctIndex: 2 },
  { id: 'q11', category: 'Geography', text: 'What is the capital of Japan?', options: ['Seoul', 'Beijing', 'Tokyo', 'Bangkok'], correctIndex: 2 },
  { id: 'q12', category: 'Geography', text: 'Which is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
  { id: 'q13', category: 'Geography', text: 'What country has the most natural lakes?', options: ['Canada', 'Russia', 'USA', 'Brazil'], correctIndex: 0 },
  { id: 'q14', category: 'Geography', text: 'What is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], correctIndex: 1 },
  { id: 'q15', category: 'Geography', text: 'Which desert is the largest hot desert?', options: ['Gobi', 'Kalahari', 'Sahara', 'Arabian'], correctIndex: 2 },
  { id: 'q16', category: 'Geography', text: 'What is the smallest country in the world?', options: ['Monaco', 'Vatican City', 'Malta', 'San Marino'], correctIndex: 1 },
  { id: 'q17', category: 'Geography', text: 'Which continent is the Sahara Desert on?', options: ['Asia', 'Australia', 'Africa', 'South America'], correctIndex: 2 },
  { id: 'q18', category: 'Geography', text: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Perth', 'Canberra'], correctIndex: 3 },
  { id: 'q19', category: 'History', text: 'Who painted the Mona Lisa?', options: ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Van Gogh'], correctIndex: 1 },
  { id: 'q20', category: 'History', text: 'In which year did World War II end?', options: ['1943', '1944', '1945', '1946'], correctIndex: 2 },
  { id: 'q21', category: 'History', text: 'Who was the first person to walk on the Moon?', options: ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Michael Collins'], correctIndex: 2 },
  { id: 'q22', category: 'History', text: 'Which ancient civilization built the pyramids of Giza?', options: ['Romans', 'Greeks', 'Mayans', 'Egyptians'], correctIndex: 3 },
  { id: 'q23', category: 'History', text: 'Who invented the light bulb?', options: ['Thomas Edison', 'Nikola Tesla', 'Alexander Bell', 'James Watt'], correctIndex: 0 },
  { id: 'q24', category: 'Sports', text: 'How many players are on a soccer team on the field?', options: ['9', '10', '11', '12'], correctIndex: 2 },
  { id: 'q25', category: 'Sports', text: 'In which sport would you perform a slam dunk?', options: ['Volleyball', 'Tennis', 'Basketball', 'Baseball'], correctIndex: 2 },
  { id: 'q26', category: 'Sports', text: 'How many rings are on the Olympic flag?', options: ['4', '5', '6', '7'], correctIndex: 1 },
  { id: 'q27', category: 'Sports', text: 'Which country invented table tennis?', options: ['China', 'Japan', 'England', 'USA'], correctIndex: 2 },
  { id: 'q28', category: 'Sports', text: 'What is the duration of a standard basketball game (NBA)?', options: ['40 min', '48 min', '50 min', '60 min'], correctIndex: 1 },
  { id: 'q29', category: 'Entertainment', text: 'What is the highest-grossing film of all time?', options: ['Titanic', 'Avatar', 'Avengers: Endgame', 'Star Wars'], correctIndex: 1 },
  { id: 'q30', category: 'Entertainment', text: 'Who is known as the "King of Pop"?', options: ['Elvis Presley', 'Prince', 'Michael Jackson', 'Freddie Mercury'], correctIndex: 2 },
  { id: 'q31', category: 'Entertainment', text: 'What instrument does Yo-Yo Ma play?', options: ['Violin', 'Piano', 'Cello', 'Flute'], correctIndex: 2 },
  { id: 'q32', category: 'Entertainment', text: 'In which game series does Mario appear?', options: ['Sonic', 'Super Mario', 'Zelda', 'Metroid'], correctIndex: 1 },
  { id: 'q33', category: 'Entertainment', text: 'Which band performed "Bohemian Rhapsody"?', options: ['The Beatles', 'Queen', 'Pink Floyd', 'Led Zeppelin'], correctIndex: 1 },
  { id: 'q34', category: 'Food & Drink', text: 'Which country is the largest producer of coffee?', options: ['Colombia', 'Vietnam', 'Ethiopia', 'Brazil'], correctIndex: 3 },
  { id: 'q35', category: 'Food & Drink', text: 'What is the main ingredient in guacamole?', options: ['Tomato', 'Avocado', 'Pepper', 'Onion'], correctIndex: 1 },
  { id: 'q36', category: 'Food & Drink', text: 'Which fruit is known as the "king of fruits"?', options: ['Mango', 'Pineapple', 'Durian', 'Papaya'], correctIndex: 2 },
  { id: 'q37', category: 'Technology', text: 'What does "CPU" stand for?', options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Processing Unit'], correctIndex: 0 },
  { id: 'q38', category: 'Technology', text: 'Who co-founded Apple Inc.?', options: ['Bill Gates', 'Steve Jobs', 'Mark Zuckerberg', 'Jeff Bezos'], correctIndex: 1 },
  { id: 'q39', category: 'Technology', text: 'What does HTML stand for?', options: ['Hyper Text Markup Language', 'High Tech Modern Language', 'Hyperlink Transfer Markup Language', 'Home Tool Markup Language'], correctIndex: 0 },
  { id: 'q40', category: 'Technology', text: 'Which company created the JavaScript language?', options: ['Microsoft', 'Google', 'Netscape', 'IBM'], correctIndex: 2 },
  { id: 'q41', category: 'Nature', text: 'What is the largest animal on Earth?', options: ['African Elephant', 'Blue Whale', 'Giraffe', 'Colossal Squid'], correctIndex: 1 },
  { id: 'q42', category: 'Nature', text: 'How many legs does a spider have?', options: ['6', '8', '10', '12'], correctIndex: 1 },
  { id: 'q43', category: 'Nature', text: 'What is the fastest land animal?', options: ['Lion', 'Cheetah', 'Pronghorn', 'Horse'], correctIndex: 1 },
  { id: 'q44', category: 'Nature', text: 'Which bird is known for its colorful tail feathers?', options: ['Eagle', 'Owl', 'Peacock', 'Flamingo'], correctIndex: 2 },
];

const TOTAL_ROUNDS = 5;
const TIME_PER_QUESTION_MS = 15000;
const COUNTDOWN_MS = 3000;
const REVEAL_MS = 3500;

function initialState(room: LiveRoom): QuizState {
  const players: Record<string, QuizPlayerEntry> = {};
  const order: string[] = [];
  for (const [userId] of room.players) {
    players[userId] = { score: 0, answeredIndex: null, answeredAt: null, streak: 0, correct: 0, maxStreak: 0 };
    order.push(userId);
  }
  return {
    phase: 'countdown',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    question: null,
    correctIndex: null,
    players,
    order,
    usedQuestionIds: [],
    timePerQuestionMs: TIME_PER_QUESTION_MS,
    revealMs: REVEAL_MS,
  };
}

function pickQuestion(state: QuizState): QuizQuestion | null {
  const available = QUESTION_BANK.filter((q) => !state.usedQuestionIds.includes(q.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function broadcast(room: LiveRoom): void {
  emitToRoom(room, 'game:state', publicSnapshot(room));
}

export function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as QuizState;
  const revealPhase = state.phase === 'reveal' || state.phase === 'leaderboard' || state.phase === 'finished';
  const question = state.question
    ? {
        text: state.question.text,
        options: state.question.options,
        category: state.question.category,
      }
    : null;
  const players: Record<string, { score: number; answered: boolean }> = {};
  for (const userId of state.order) {
    const p = state.players[userId];
    players[userId] = {
      score: p.score,
      answered: revealPhase ? p.answeredIndex !== null : p.answeredIndex !== null,
    };
  }
  return {
    type: 'quiz',
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    question,
    correctIndex: revealPhase ? state.correctIndex : null,
    revealed: revealPhase,
    players,
    order: state.order,
    timePerQuestionMs: state.timePerQuestionMs,
  };
}

function advanceRound(room: LiveRoom): void {
  const state = room.gameState as QuizState;
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
  state.usedQuestionIds.push(question.id);
  state.question = {
    id: question.id,
    category: question.category,
    text: question.text,
    options: question.options,
  };
  state.correctIndex = question.correctIndex;
  state.phase = 'question';
  for (const userId of state.order) {
    state.players[userId].answeredIndex = null;
    state.players[userId].answeredAt = null;
  }
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'question') {
        revealRound(room);
      }
    },
    TIME_PER_QUESTION_MS,
  );
}

function revealRound(room: LiveRoom): void {
  const state = room.gameState as QuizState;
  if (state.phase !== 'question') return;
  state.phase = 'reveal';
  broadcast(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'reveal') {
        advanceRound(room);
      }
    },
    REVEAL_MS,
  );
}

function finishGame(room: LiveRoom): void {
  const state = room.gameState as QuizState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcast(room);
}

function markAnswer(room: LiveRoom, userId: string, answerIndex: number): boolean {
  const state = room.gameState as QuizState;
  if (state.phase !== 'question' || !state.question || state.correctIndex === null) return false;
  const player = state.players[userId];
  if (!player || player.answeredIndex !== null) return false;
  if (answerIndex < 0 || answerIndex >= state.question.options.length) return false;
  player.answeredIndex = answerIndex;
  player.answeredAt = Date.now();
  if (answerIndex === state.correctIndex) {
    player.streak += 1;
    player.correct += 1;
    if (player.streak > player.maxStreak) player.maxStreak = player.streak;
    const points = 100 + Math.min(player.streak, 4) * 50;
    player.score += points;
  } else {
    player.streak = 0;
  }
  const allAnswered = state.order.every((id) => state.players[id].answeredIndex !== null);
  return allAnswered;
}

export const quizGame: GameDefinition = {
  type: 'quiz',
  label: 'Brain Battle',
  description: 'Answer trivia questions faster than your friends. Streaks multiply your points!',
  icon: 'brain',
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
        if (room.gameState && (room.gameState as QuizState).phase === 'countdown') {
          advanceRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action) {
    if (action.type !== 'answer') {
      return { ok: false, error: 'unknown-action' };
    }
    const index = (action.payload as { answerIndex?: unknown } | undefined)?.answerIndex;
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      return { ok: false, error: 'invalid-answer' };
    }
    const state = room.gameState as QuizState;
    if (state.phase !== 'question') {
      return { ok: false, error: 'not-answering-phase' };
    }
    const allAnswered = markAnswer(room, userId, index);
    if (allAnswered) {
      clearTimers(room);
      revealRound(room);
      return { ok: true };
    }
    broadcast(room);
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
        if (room.gameState && (room.gameState as QuizState).phase === 'countdown') {
          advanceRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as QuizState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].score }));
  },
  highlights(room) {
    const state = room.gameState as QuizState;
    const best = state.order.reduce<{ id: string; correct: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.correct > acc.correct) return { id, correct: p.correct };
      return acc;
    }, null);
    const streakKing = state.order.reduce<{ id: string; streak: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.maxStreak > acc.streak) return { id, streak: p.maxStreak };
      return acc;
    }, null);
    return [
      ...(best && best.correct > 0
        ? [{ key: 'brainiac', emoji: '🧠', title: 'Brainiac', userId: best.id, detail: `${best.correct} correct answers.` }]
        : []),
      ...(streakKing && streakKing.streak >= 2
        ? [{ key: 'streak-king', emoji: '🔥', title: 'Streak King', userId: streakKing.id, detail: `Hit a ${streakKing.streak}-streak.` }]
        : []),
    ];
  },
};
