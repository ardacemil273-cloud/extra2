import type { LiveRoom } from '../socket/store';
import { emitToUser, schedule } from '../socket/store';
import { broadcastGameState } from './core';
import type { GameDefinition, GameAction } from './types';
import { censor } from '../utils/profanity';

export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
}

export interface TelephoneStep {
  kind: 'prompt' | 'caption' | 'draw';
  text?: string;
  strokes?: Stroke[];
}

interface TelephonePlayerEntry {
  score: number;
  submitted: boolean;
  strokesSent: number;
  strokeResetAt: number;
}

export interface TelephoneState {
  phase: 'countdown' | 'prompt' | 'draw' | 'caption' | 'reveal' | 'finished';
  stepIndex: number;
  totalSteps: number;
  pages: Record<string, { ownerId: string; holderId: string; steps: TelephoneStep[] }>;
  players: Record<string, TelephonePlayerEntry>;
  order: string[];
  roundEndAt: number;
  timerMs: number;
  votes: Record<string, string>;
  voted: Record<string, boolean>;
}

const STEP_KINDS: ('prompt' | 'caption' | 'draw')[] = ['prompt', 'draw', 'caption', 'draw'];
const STEP_TIMERS = [40000, 60000, 40000, 60000];
const COUNTDOWN_MS = 3000;
const REVEAL_MS = 30000;
const MAX_STROKES_PER_SEC = 25;

function initialState(room: LiveRoom): TelephoneState {
  const order: string[] = [];
  const players: Record<string, TelephonePlayerEntry> = {};
  const pages: Record<string, { ownerId: string; holderId: string; steps: TelephoneStep[] }> = {};
  for (const [userId] of room.players) {
    order.push(userId);
    players[userId] = { score: 0, submitted: false, strokesSent: 0, strokeResetAt: Date.now() };
    pages[userId] = { ownerId: userId, holderId: userId, steps: [] };
  }
  return {
    phase: 'countdown',
    stepIndex: 0,
    totalSteps: STEP_KINDS.length,
    pages,
    players,
    order,
    roundEndAt: 0,
    timerMs: STEP_TIMERS[0],
    votes: {},
    voted: {},
  };
}

function currentKind(state: TelephoneState): 'prompt' | 'caption' | 'draw' {
  return STEP_KINDS[state.stepIndex];
}

function rotatePages(state: TelephoneState): void {
  for (const page of Object.values(state.pages)) {
    const idx = state.order.indexOf(page.holderId);
    page.holderId = state.order[(idx + 1) % state.order.length];
  }
}

function startStep(room: LiveRoom): void {
  const state = room.gameState as TelephoneState;
  const kind = currentKind(state);
  state.phase = kind;
  state.timerMs = STEP_TIMERS[state.stepIndex];
  state.roundEndAt = Date.now() + state.timerMs;
  for (const userId of state.order) {
    state.players[userId].submitted = false;
    state.players[userId].strokesSent = 0;
    state.players[userId].strokeResetAt = Date.now();
  }
  broadcastGameState(room);
  schedule(
    room,
    () => {
      if (room.gameState === state && state.phase === kind) {
        advanceStep(room);
      }
    },
    state.timerMs,
  );
}

function advanceStep(room: LiveRoom): void {
  const state = room.gameState as TelephoneState;
  if (state.stepIndex + 1 >= state.totalSteps) {
    rotatePages(state);
    state.phase = 'reveal';
    state.timerMs = REVEAL_MS;
    state.roundEndAt = Date.now() + REVEAL_MS;
    state.votes = {};
    state.voted = {};
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState === state && state.phase === 'reveal') {
          finishGame(room);
        }
      },
      REVEAL_MS,
    );
    return;
  }
  rotatePages(state);
  state.stepIndex += 1;
  startStep(room);
}

function finishGame(room: LiveRoom): void {
  const state = room.gameState as TelephoneState;
  state.phase = 'finished';
  room.status = 'finished';
  room.onFinished?.();
  broadcastGameState(room);
}

function publicSnapshot(room: LiveRoom): unknown {
  const state = room.gameState as TelephoneState;
  const pages =
    state.phase === 'reveal' || state.phase === 'finished'
      ? Object.values(state.pages).map((p) => ({
          ownerId: p.ownerId,
          steps: p.steps,
        }))
      : null;
  const players: Record<string, { score: number; submitted: boolean }> = {};
  for (const userId of state.order) {
    players[userId] = {
      score: state.players[userId].score,
      submitted: state.players[userId].submitted,
    };
  }
  return {
    type: 'telephone',
    phase: state.phase,
    stepIndex: state.stepIndex,
    totalSteps: state.totalSteps,
    kind: state.phase === 'prompt' || state.phase === 'draw' || state.phase === 'caption' ? currentKind(state) : null,
    players,
    order: state.order,
    roundEndAt: state.roundEndAt,
    timerMs: state.timerMs,
    pages,
    votes: state.phase === 'reveal' || state.phase === 'finished' ? state.votes : null,
  };
}

function personalSnapshot(room: LiveRoom, userId: string): unknown {
  const state = room.gameState as TelephoneState;
  const base = publicSnapshot(room) as Record<string, unknown>;
  if (state.phase === 'reveal' || state.phase === 'finished') {
    return base;
  }
  const held = Object.values(state.pages).find((p) => p.holderId === userId);
  const history = held ? held.steps.slice(0, state.stepIndex) : [];
  return {
    ...base,
    page: held
      ? {
          ownerId: held.ownerId,
          history,
        }
      : null,
    me: {
      submitted: state.players[userId]?.submitted ?? false,
    },
  };
}

export const telephoneGame: GameDefinition = {
  type: 'telephone',
  label: 'Telephone',
  description: 'A sentence becomes a drawing, then a caption, then a drawing again. Chaos guaranteed!',
  icon: '📞',
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
        if (room.gameState && (room.gameState as TelephoneState).phase === 'countdown') {
          startStep(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  handleAction(room, userId, action: GameAction) {
    const state = room.gameState as TelephoneState;
    const kind = currentKind(state);
    if (action.type === 'submitText') {
      if (state.phase !== 'prompt' && state.phase !== 'caption') {
        return { ok: false, error: 'not-text-phase' };
      }
      const text = (action.payload as { text?: unknown } | undefined)?.text;
      if (typeof text !== 'string' || text.trim().length < 1 || text.length > 120) {
        return { ok: false, error: 'invalid-text' };
      }
      const clean = censor(text.trim());
      if (clean.length < 1) return { ok: false, error: 'invalid-text' };
      const entry = state.players[userId];
      if (!entry || entry.submitted) return { ok: false, error: 'already-submitted' };
      entry.submitted = true;
      const held = Object.values(state.pages).find((p) => p.holderId === userId);
      if (held) {
        held.steps.push({ kind, text: clean });
      }
      const allSubmitted = state.order.every((id) => state.players[id].submitted);
      broadcastGameState(room);
      if (allSubmitted) advanceStep(room);
      return { ok: true };
    }
    if (action.type === 'stroke') {
      if (state.phase !== 'draw') return { ok: false, error: 'not-draw-phase' };
      const entry = state.players[userId];
      if (!entry || entry.submitted) return { ok: false, error: 'already-submitted' };
      const now = Date.now();
      if (now - entry.strokeResetAt > 1000) {
        entry.strokeResetAt = now;
        entry.strokesSent = 0;
      }
      entry.strokesSent += 1;
      if (entry.strokesSent > MAX_STROKES_PER_SEC) return { ok: false, error: 'rate-limited' };
      const payload = action.payload as { points?: unknown; color?: unknown; size?: unknown; tool?: unknown } | undefined;
      const points = payload?.points;
      if (!Array.isArray(points) || points.length === 0 || points.length > 500) {
        return { ok: false, error: 'invalid-stroke' };
      }
      const clean = (points as unknown[]).map((p) => {
        if (typeof p !== 'object' || p === null) return null;
        const pt = p as { x?: unknown; y?: unknown };
        if (typeof pt.x !== 'number' || typeof pt.y !== 'number' || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
        return { x: pt.x, y: pt.y };
      });
      if (clean.some((c) => c === null)) return { ok: false, error: 'invalid-stroke' };
      const stroke: Stroke = {
        points: clean as { x: number; y: number }[],
        color: typeof payload?.color === 'string' && payload.color.length <= 16 ? payload.color : '#000000',
        size: typeof payload?.size === 'number' && payload.size > 0 && payload.size <= 100 ? payload.size : 4,
        tool: payload?.tool === 'eraser' ? 'eraser' : 'pen',
      };
      const held = Object.values(state.pages).find((p) => p.holderId === userId);
      if (!held) return { ok: false, error: 'no-page' };
      const step = held.steps[state.stepIndex] ?? { kind: 'draw' as const, strokes: [] };
      if (!step.strokes) step.strokes = [];
      step.strokes.push(stroke);
      held.steps[state.stepIndex] = step;
      emitToUser(userId, 'game:stroke', { from: userId, ...stroke });
      return { ok: true };
    }
    if (action.type === 'submitDraw') {
      if (state.phase !== 'draw') return { ok: false, error: 'not-draw-phase' };
      const entry = state.players[userId];
      if (!entry || entry.submitted) return { ok: false, error: 'already-submitted' };
      const held = Object.values(state.pages).find((p) => p.holderId === userId);
      const step = held?.steps[state.stepIndex];
      if (!held || !step?.strokes || step.strokes.length === 0) {
        return { ok: false, error: 'nothing-drawn' };
      }
      entry.submitted = true;
      const allSubmitted = state.order.every((id) => state.players[id].submitted);
      broadcastGameState(room);
      if (allSubmitted) advanceStep(room);
      return { ok: true };
    }
    if (action.type === 'vote') {
      if (state.phase !== 'reveal') return { ok: false, error: 'not-vote-phase' };
      if (state.voted[userId]) return { ok: false, error: 'already-voted' };
      const ownerId = (action.payload as { ownerId?: unknown } | undefined)?.ownerId;
      if (typeof ownerId !== 'string' || !state.pages[ownerId]) {
        return { ok: false, error: 'invalid-vote' };
      }
      state.voted[userId] = true;
      state.votes[userId] = ownerId;
      const allVoted = state.order.every((id) => state.voted[id]);
      broadcastGameState(room);
      if (allVoted) finishGame(room);
      return { ok: true };
    }
    return { ok: false, error: 'unknown-action' };
  },
  stop(room) {
    const state = room.gameState as TelephoneState;
    if (state) state.phase = 'finished';
  },
  restart(room) {
    room.gameState = initialState(room);
    room.status = 'playing';
    broadcastGameState(room);
    schedule(
      room,
      () => {
        if (room.gameState && (room.gameState as TelephoneState).phase === 'countdown') {
          startStep(room);
        }
      },
      COUNTDOWN_MS,
    );
  },
  results(room) {
    const state = room.gameState as TelephoneState;
    const scores: Record<string, number> = {};
    for (const userId of state.order) {
      scores[userId] = 0;
    }
    for (const target of Object.values(state.votes)) {
      scores[target] = (scores[target] ?? 0) + 100;
    }
    return state.order.map((id) => ({ userId: id, score: scores[id] ?? 0 }));
  },
  highlights(room) {
    const state = room.gameState as TelephoneState;
    const voteCounts: Record<string, number> = {};
    for (const target of Object.values(state.votes)) {
      voteCounts[target] = (voteCounts[target] ?? 0) + 1;
    }
    let storyStealer: { id: string; n: number } | null = null;
    for (const [ownerId, n] of Object.entries(voteCounts)) {
      if (!storyStealer || n > storyStealer.n) storyStealer = { id: ownerId, n };
    }
    const strokeCounts: Record<string, number> = {};
    for (const page of Object.values(state.pages)) {
      let total = 0;
      for (const step of page.steps) {
        if (step.strokes) total += step.strokes.length;
      }
      strokeCounts[page.ownerId] = (strokeCounts[page.ownerId] ?? 0) + total;
    }
    let doodler: { id: string; n: number } | null = null;
    for (const [ownerId, n] of Object.entries(strokeCounts)) {
      if (!doodler || n > doodler.n) doodler = { id: ownerId, n };
    }
    return [
      ...(storyStealer && storyStealer.n > 0
        ? [{ key: 'story-stealer', emoji: '📖', title: 'Story Stealer', userId: storyStealer.id, detail: `${storyStealer.n} votes for their page.` }]
        : []),
      ...(doodler && doodler.n > 0
        ? [{ key: 'doodle-heavy', emoji: '✏️', title: 'Doodle Machine', userId: doodler.id, detail: `Drew ${doodler.n} strokes of chaos.` }]
        : []),
    ];
  },
};
