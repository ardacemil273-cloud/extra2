import type { LiveRoom } from '../socket/store';
import { emitToRoom, schedule } from '../socket/store';
import { broadcastGameState } from './core';
import type { GameDefinition, GameAction } from './types';

interface DrawPlayerEntry {
  score: number;
  guessed: boolean;
  guessedCount: number;
  drawerGuesses: number;
  strokesSent: number;
  strokeResetAt: number;
}

export interface DrawState {
  phase: 'countdown' | 'drawing' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  drawerId: string;
  word: string;
  wordPattern: string;
  hint: string;
  players: Record<string, DrawPlayerEntry>;
  order: string[];
  roundEndAt: number;
  timerMs: number;
  revealed: boolean;
}

interface WordEntry {
  word: string;
  hint: string;
}

const WORDS: WordEntry[] = [
  { word: 'cat', hint: 'Animal' },
  { word: 'dog', hint: 'Animal' },
  { word: 'elephant', hint: 'Animal' },
  { word: 'giraffe', hint: 'Animal' },
  { word: 'penguin', hint: 'Animal' },
  { word: 'dragon', hint: 'Animal' },
  { word: 'butterfly', hint: 'Animal' },
  { word: 'shark', hint: 'Animal' },
  { word: 'house', hint: 'Object' },
  { word: 'castle', hint: 'Object' },
  { word: 'bridge', hint: 'Object' },
  { word: 'ladder', hint: 'Object' },
  { word: 'umbrella', hint: 'Object' },
  { word: 'keyboard', hint: 'Object' },
  { word: 'clock', hint: 'Object' },
  { word: 'bicycle', hint: 'Object' },
  { word: 'car', hint: 'Object' },
  { word: 'rocket', hint: 'Object' },
  { word: 'pizza', hint: 'Food' },
  { word: 'hamburger', hint: 'Food' },
  { word: 'icecream', hint: 'Food' },
  { word: 'watermelon', hint: 'Food' },
  { word: 'coffee', hint: 'Food' },
  { word: 'banana', hint: 'Food' },
  { word: 'sun', hint: 'Nature' },
  { word: 'moon', hint: 'Nature' },
  { word: 'rainbow', hint: 'Nature' },
  { word: 'mountain', hint: 'Nature' },
  { word: 'volcano', hint: 'Nature' },
  { word: 'tree', hint: 'Nature' },
  { word: 'flower', hint: 'Nature' },
  { word: 'heart', hint: 'Symbol' },
  { word: 'star', hint: 'Symbol' },
  { word: 'fire', hint: 'Symbol' },
  { word: 'skull', hint: 'Symbol' },
  { word: 'crown', hint: 'Symbol' },
  { word: 'ghost', hint: 'Symbol' },
  { word: 'robot', hint: 'Tech' },
  { word: 'computer', hint: 'Tech' },
  { word: 'phone', hint: 'Tech' },
  { word: 'television', hint: 'Tech' },
  { word: 'camera', hint: 'Tech' },
  { word: 'pirate', hint: 'People' },
  { word: 'superhero', hint: 'People' },
  { word: 'snowman', hint: 'People' },
  { word: 'mermaid', hint: 'People' },
  { word: 'alien', hint: 'People' },
  { word: 'airplane', hint: 'Vehicle' },
  { word: 'train', hint: 'Vehicle' },
  { word: 'boat', hint: 'Vehicle' },
  { word: 'helicopter', hint: 'Vehicle' },
  { word: 'submarine', hint: 'Vehicle' },
];

const TOTAL_ROUNDS = 4;
const COUNTDOWN_MS = 3000;
const DRAW_MS = 60000;
const REVEAL_MS = 5000;
const MAX_STROKES_PER_SEC = 25;

function pickWord(used: string[]): WordEntry {
  const available = WORDS.filter((w) => !used.includes(w.word));
  const pool = available.length > 0 ? available : WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function makePattern(word: string): string {
  return word
    .split('')
    .map((ch) => (/[a-z0-9]/i.test(ch) ? '_' : ch))
    .join(' ');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function initialState(room: LiveRoom): DrawState {
  const players: Record<string, DrawPlayerEntry> = {};
  const order: string[] = [];
  for (const [userId] of room.players) {
    players[userId] = { score: 0, guessed: false, guessedCount: 0, drawerGuesses: 0, strokesSent: 0, strokeResetAt: Date.now() };
    order.push(userId);
  }
  return {
    phase: 'countdown',
    round: 0,
    totalRounds: TOTAL_ROUNDS,
    drawerId: order[0] ?? '',
    word: '',
    wordPattern: '',
    hint: '',
    players,
    order,
    roundEndAt: 0,
    timerMs: DRAW_MS,
    revealed: false,
  };
}

function beginRound(room: LiveRoom): void {
  const state = room.gameState as DrawState;
  if (state.round >= state.totalRounds) {
    finishGame(room);
    return;
  }
  state.round += 1;
  state.revealed = false;
  const drawerIndex = (state.round - 1) % state.order.length;
  state.drawerId = state.order[drawerIndex];
  const wordEntry = pickWord([]);
  state.word = wordEntry.word;
  state.hint = wordEntry.hint;
  state.wordPattern = makePattern(state.word);
  for (const userId of state.order) {
    const p = state.players[userId];
    p.guessed = false;
    p.strokesSent = 0;
    p.strokeResetAt = Date.now();
  }
  state.phase = 'countdown';
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'countdown') {
        startDrawing(room);
      }
    },
    COUNTDOWN_MS,
  );
}

function startDrawing(room: LiveRoom): void {
  const state = room.gameState as DrawState;
  state.phase = 'drawing';
  state.roundEndAt = Date.now() + DRAW_MS;
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === 'drawing') {
        revealRound(room);
      }
    },
    DRAW_MS,
  );
}

function revealRound(room: LiveRoom): void {
  const state = room.gameState as DrawState;
  if (state.phase !== 'drawing') return;
  state.phase = 'reveal';
  state.revealed = true;
  broadcastGameState(room);
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

function finishGame(room: LiveRoom): void {
  const state = room.gameState as DrawState;
  state.phase = 'finished';
  state.revealed = true;
  room.status = 'finished';
  room.onFinished?.();
  broadcastGameState(room);
}

function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as DrawState;
  const players: Record<string, { score: number; guessed: boolean }> = {};
  for (const userId of state.order) {
    players[userId] = { score: state.players[userId].score, guessed: state.players[userId].guessed };
  }
  return {
    type: 'draw',
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    drawerId: state.drawerId,
    wordPattern: state.phase === 'reveal' || state.phase === 'finished' ? state.word : state.wordPattern,
    word: state.phase === 'reveal' || state.phase === 'finished' ? state.word : null,
    hint: state.phase === 'drawing' ? state.hint : null,
    players,
    order: state.order,
    roundEndAt: state.roundEndAt,
    timerMs: state.timerMs,
    revealed: state.revealed,
  };
}

function personalSnapshot(room: LiveRoom, userId: string): unknown {
  const state = room.gameState as DrawState;
  const base = publicSnapshot(room) as Record<string, unknown>;
  const isDrawer = state.drawerId === userId;
  const isReveal = state.phase === 'reveal' || state.phase === 'finished';
  return {
    ...base,
    word: isReveal || isDrawer ? state.word : null,
    isDrawer,
  };
}

function handleGuess(room: LiveRoom, userId: string, text: unknown): boolean {
  const state = room.gameState as DrawState;
  if (state.phase !== 'drawing' || typeof text !== 'string') return false;
  const player = state.players[userId];
  if (!player || player.guessed) return false;
  if (userId === state.drawerId) return false;
  if (text.trim().length < 1 || text.length > 40) return false;
  const guess = normalize(text);
  if (guess.length < 2) return false;
  const target = normalize(state.word);
  if (guess !== target) return false;
  player.guessed = true;
  player.guessedCount += 1;
  const remainingMs = Math.max(0, state.roundEndAt - Date.now());
  const bonus = Math.round((remainingMs / 1000) * 5);
  const earned = 100 + bonus;
  player.score += earned;
  const drawer = state.players[state.drawerId];
  if (drawer) {
    drawer.score += 60;
    drawer.drawerGuesses += 1;
  }
  emitToRoom(room, 'game:revealGuess', { userId, points: earned });
  const allGuessed = state.order.filter((id) => id !== state.drawerId).every((id) => state.players[id].guessed);
  broadcastGameState(room);
  return allGuessed;
}

export const drawGame: GameDefinition = {
  type: 'draw',
  label: 'Draw & Guess',
  description: 'One player draws, everyone else races to guess the word. Skribbl-style fun!',
  icon: '🎨',
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
        if (room.gameState && (room.gameState as DrawState).phase === 'countdown') {
          beginRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action: GameAction) {
    const state = room.gameState as DrawState;
    if (action.type === 'stroke') {
      if (state.phase !== 'drawing') return { ok: false, error: 'not-drawing-phase' };
      const entry = state.players[userId];
      if (!entry) return { ok: false, error: 'not-in-game' };
      if (state.drawerId !== userId) return { ok: false, error: 'not-drawer' };
      const now = Date.now();
      if (now - entry.strokeResetAt > 1000) {
        entry.strokeResetAt = now;
        entry.strokesSent = 0;
      }
      entry.strokesSent += 1;
      if (entry.strokesSent > MAX_STROKES_PER_SEC) {
        return { ok: false, error: 'rate-limited' };
      }
      const payload = action.payload as { points?: unknown; color?: unknown; size?: unknown; tool?: unknown } | undefined;
      const points = payload?.points;
      if (!Array.isArray(points) || points.length === 0 || points.length > 500) {
        return { ok: false, error: 'invalid-stroke' };
      }
      const clean = (points as unknown[]).map((p) => {
        if (typeof p !== 'object' || p === null) return null;
        const pt = p as { x?: unknown; y?: unknown };
        if (typeof pt.x !== 'number' || typeof pt.y !== 'number') return null;
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
        return { x: pt.x, y: pt.y };
      });
      if (clean.some((c) => c === null)) return { ok: false, error: 'invalid-stroke' };
      const color = typeof payload?.color === 'string' && payload.color.length <= 16 ? payload.color : '#000000';
      const size = typeof payload?.size === 'number' && payload.size > 0 && payload.size <= 100 ? payload.size : 4;
      const tool = payload?.tool === 'eraser' ? 'eraser' : 'pen';
      emitToRoom(room, 'game:stroke', { from: userId, points: clean, color, size, tool });
      return { ok: true };
    }
    if (action.type === 'clear') {
      if (state.phase !== 'drawing' || state.drawerId !== userId) {
        return { ok: false, error: 'not-drawer' };
      }
      emitToRoom(room, 'game:clear', { from: userId });
      return { ok: true };
    }
    if (action.type === 'guess') {
      const text = (action.payload as { text?: unknown } | undefined)?.text;
      const allGuessed = handleGuess(room, userId, text);
      if (allGuessed) {
        revealRound(room);
        return { ok: true };
      }
      return { ok: true };
    }
    return { ok: false, error: 'unknown-action' };
  },
  stop(room) {
    const state = room.gameState as DrawState;
    if (state) state.phase = 'finished';
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as DrawState).phase === 'countdown') {
          beginRound(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as DrawState;
    return state.order.map((id) => ({ userId: id, score: state.players[id].score }));
  },
  highlights(room) {
    const state = room.gameState as DrawState;
    const wizard = state.order.reduce<{ id: string; n: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.guessedCount > acc.n) return { id, n: p.guessedCount };
      return acc;
    }, null);
    const canvasChaos = state.order.reduce<{ id: string; n: number } | null>((acc, id) => {
      const p = state.players[id];
      if (!acc || p.drawerGuesses > acc.n) return { id, n: p.drawerGuesses };
      return acc;
    }, null);
    return [
      ...(wizard && wizard.n > 0
        ? [{ key: 'word-wizard', emoji: '🔮', title: 'Word Wizard', userId: wizard.id, detail: `Guessed ${wizard.n} words.` }]
        : []),
      ...(canvasChaos && canvasChaos.n > 0
        ? [{ key: 'canvas-chaos', emoji: '🎨', title: 'Canvas Chaos', userId: canvasChaos.id, detail: `${canvasChaos.n} drawings were too easy.` }]
        : []),
    ];
  },
};
