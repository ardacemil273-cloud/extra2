import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestEnv, registerUser, createRoom, TestSocket, type TestEnv } from './helpers';

let env: TestEnv;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

function baseUrl(): string {
  return env.baseUrl;
}

describe('Room membership (server-authoritative realtime)', () => {
  it('two users join the same room and see each other without refresh', async () => {
    const a = await registerUser(baseUrl(), 'alice');
    const b = await registerUser(baseUrl(), 'bob');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();

    sockA.emit('room:join', { code });
    const aState = await sockA.waitFor<typeof room>('room:state', () => true);
    expect(aState.players.map((p) => p.userId)).toEqual([a.user.id]);
    expect(aState.room.code).toBe(code);

    sockB.emit('room:join', { code });
    const bState = await sockB.waitFor<typeof room>('room:state', () => true);
    expect(bState.players.map((p) => p.userId)).toEqual([a.user.id, b.user.id]);

    const aSeesB = await sockA.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string }[] }).players.some((pl) => pl.userId === b.user.id),
    );
    expect(aSeesB.players.map((p) => p.userId)).toContain(b.user.id);

    await sockA.close();
    await sockB.close();
  });

  it('ready / unready synchronizes to every player instantly', async () => {
    const a = await registerUser(baseUrl(), 'ready_a');
    const b = await registerUser(baseUrl(), 'ready_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:ready', { ready: true });
    const bSeesReady = await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string; isReady: boolean }[] }).players.some(
        (pl) => pl.userId === a.user.id && pl.isReady === true,
      ),
    );
    expect(bSeesReady.players.find((p) => p.userId === a.user.id)?.isReady).toBe(true);

    sockA.emit('room:ready', { ready: false });
    const bSeesUnready = await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string; isReady: boolean }[] }).players.some(
        (pl) => pl.userId === a.user.id && pl.isReady === false,
      ),
    );
    expect(bSeesUnready.players.find((p) => p.userId === a.user.id)?.isReady).toBe(false);

    await sockA.close();
    await sockB.close();
  });

  it('a new player joining is seen by everyone already in the room', async () => {
    const a = await registerUser(baseUrl(), 'seen_a');
    const b = await registerUser(baseUrl(), 'seen_b');
    const c = await registerUser(baseUrl(), 'seen_c');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    const sockC = new TestSocket(baseUrl(), c.token);
    await sockA.connect();
    await sockB.connect();
    await sockC.connect();

    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockC.emit('room:join', { code });
    await sockC.waitFor('room:state', () => true);

    const aSeesC = await sockA.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string }[] }).players.some((pl) => pl.userId === c.user.id),
    );
    const bSeesC = await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string }[] }).players.some((pl) => pl.userId === c.user.id),
    );
    expect(aSeesC.players).toHaveLength(3);
    expect(bSeesC.players).toHaveLength(3);

    await sockA.close();
    await sockB.close();
    await sockC.close();
  });

  it('a player leaving is removed from everyone screens instantly', async () => {
    const a = await registerUser(baseUrl(), 'leave_a');
    const b = await registerUser(baseUrl(), 'leave_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    const bSeesLeave = sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string }[] }).players.length === 1,
    );
    sockA.emit('room:leave');
    await sockA.waitFor('room:left', () => true);

    const leaveState = await bSeesLeave;
    expect(leaveState.players.some((p) => p.userId === a.user.id)).toBe(false);
    expect(leaveState.players[0].userId).toBe(b.user.id);
    expect(leaveState.room.ownerId).toBe(b.user.id);

    await sockA.close();
    await sockB.close();
  });

  it('host ownership transfers when the host leaves', async () => {
    const a = await registerUser(baseUrl(), 'host_a');
    const b = await registerUser(baseUrl(), 'host_b');
    const c = await registerUser(baseUrl(), 'host_c');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    const sockC = new TestSocket(baseUrl(), c.token);
    await sockA.connect();
    await sockB.connect();
    await sockC.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);
    sockC.emit('room:join', { code });
    await sockC.waitFor('room:state', () => true);

    const bSeesNewHost = sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { room: { ownerId: string } }).room.ownerId === b.user.id,
    );
    sockA.emit('room:leave');
    await sockA.waitFor('room:left', () => true);
    const newHostState = await bSeesNewHost;
    expect(newHostState.room.ownerId).toBe(b.user.id);
    const newHostPlayer = newHostState.players.find((p) => p.userId === b.user.id);
    expect(newHostPlayer?.isHost).toBe(true);

    await sockA.close();
    await sockB.close();
    await sockC.close();
  });

  it('cannot join a room that is mid-game', async () => {
    const a = await registerUser(baseUrl(), 'join_blocked_a');
    const b = await registerUser(baseUrl(), 'join_blocked_b');
    const c = await registerUser(baseUrl(), 'join_blocked_c');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    const sockC = new TestSocket(baseUrl(), c.token);
    await sockA.connect();
    await sockB.connect();
    await sockC.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:ready', { ready: true });
    sockB.emit('room:ready', { ready: true });
    await sockA.waitFor('room:update', (p) =>
      (p as { players: { isReady: boolean }[] }).players.every((pl) => pl.isReady),
    );
    sockA.emit('room:selectGame', { gameType: 'quiz' });
    await sockA.waitFor('room:update', (p) => (p as { room: { gameType: string } }).room.gameType === 'quiz');
    sockA.emit('room:start');

    await sockA.waitFor<unknown>('game:state', (p) =>
      (p as { phase?: string }).phase === 'countdown',
    );

    sockC.emit('room:join', { code });
    const err = await sockC.waitFor<{ code: string; message: string }>('error', (p) =>
      (p as { code: string }).code === 'room-in-game',
    );
    expect(err.code).toBe('room-in-game');

    await sockA.close();
    await sockB.close();
    await sockC.close();
  });
});

describe('Reconnect and rejoin', () => {
  it('after a socket drop, the player can reconnect and receives the correct authoritative state', async () => {
    const a = await registerUser(baseUrl(), 'reconnect_a');
    const b = await registerUser(baseUrl(), 'reconnect_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:ready', { ready: true });
    await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string; isReady: boolean }[] }).players.some(
        (pl) => pl.userId === a.user.id && pl.isReady,
      ),
    );

    const roomId = sockA.roomState!.room.id;

    sockA.disconnect();
    const bSeesDisconnect = await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string; connected: boolean }[] }).players.some(
        (pl) => pl.userId === a.user.id && pl.connected === false,
      ),
    );
    expect(bSeesDisconnect.players.find((p) => p.userId === a.user.id)?.connected).toBe(false);

    const sockA2 = new TestSocket(baseUrl(), a.token);
    await sockA2.connect();
    sockA2.emit('room:rejoin', { roomId });

    const freshState = await sockA2.waitFor<typeof room>('room:state', () => true);
    expect(freshState.room.id).toBe(roomId);
    expect(freshState.players).toHaveLength(2);
    expect(freshState.players.find((p) => p.userId === a.user.id)?.connected).toBe(true);
    expect(freshState.players.find((p) => p.userId === a.user.id)?.isReady).toBe(true);

    const bSeesReconnect = await sockB.waitFor<typeof room>('room:update', (p) =>
      (p as { players: { userId: string; connected: boolean }[] }).players.some(
        (pl) => pl.userId === a.user.id && pl.connected === true,
      ),
    );
    expect(bSeesReconnect.players.find((p) => p.userId === a.user.id)?.connected).toBe(true);

    await sockB.close();
    await sockA2.close();
  });
});

describe('Quiz game (server-authoritative state + actions)', () => {
  it('all players receive the same game state and answers are applied exactly once', async () => {
    const a = await registerUser(baseUrl(), 'quiz_a');
    const b = await registerUser(baseUrl(), 'quiz_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:ready', { ready: true });
    sockB.emit('room:ready', { ready: true });
    await sockA.waitFor('room:update', (p) =>
      (p as { players: { isReady: boolean }[] }).players.every((pl) => pl.isReady),
    );

    sockA.emit('room:selectGame', { gameType: 'quiz' });
    await sockA.waitFor('room:update', (p) => (p as { room: { gameType: string } }).room.gameType === 'quiz');

    sockA.emit('room:start');

    const aStart = await sockA.waitFor<{ phase: string; question: unknown; correctIndex: number | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'countdown',
    );
    const bStart = await sockB.waitFor<{ phase: string; question: unknown; correctIndex: number | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'countdown',
    );
    expect(aStart.phase).toBe('countdown');
    expect(bStart.phase).toBe('countdown');

    const aQuestion = await sockA.waitFor<{ phase: string; question: { text: string; options: string[] }; correctIndex: number | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'question',
    );
    const bQuestion = await sockB.waitFor<{ phase: string; question: { text: string; options: string[] }; correctIndex: number | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'question',
    );
    expect(aQuestion.question!.text).toBe(bQuestion.question!.text);
    expect(aQuestion.question!.options).toEqual(bQuestion.question!.options);
    expect(aQuestion.correctIndex).toBeNull();
    expect(bQuestion.correctIndex).toBeNull();

    sockA.emit('game:action', { type: 'answer', payload: { answerIndex: 0 } });
    sockA.emit('game:action', { type: 'answer', payload: { answerIndex: 1 } });
    sockB.emit('game:action', { type: 'answer', payload: { answerIndex: 0 } });

    const aReveal = await sockA.waitFor<{ phase: string; correctIndex: number | null; players: Record<string, { score: number }> }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'reveal',
    );
    const bReveal = await sockB.waitFor<{ phase: string; correctIndex: number | null; players: Record<string, { score: number }> }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'reveal',
    );
    expect(aReveal.correctIndex).not.toBeNull();
    expect(bReveal.correctIndex).toBe(aReveal.correctIndex);

    const correct = aReveal.correctIndex!;
    const expected = 100 + 1 * 50;
    expect(aReveal.players[a.user.id].score).toBe(correct === 0 ? expected : 0);
    expect(bReveal.players[b.user.id].score).toBe(correct === 0 ? expected : 0);
    expect(aReveal.players[a.user.id].score).toBeLessThanOrEqual(expected);

    await sockA.close();
    await sockB.close();
  });

  it('non-host players cannot start the game or change the game selection', async () => {
    const a = await registerUser(baseUrl(), 'authz_a');
    const b = await registerUser(baseUrl(), 'authz_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockB.emit('room:selectGame', { gameType: 'rps' });
    const err = await sockB.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'not-host');
    expect(err.code).toBe('not-host');

    sockB.emit('room:start');
    const err2 = await sockB.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'not-host');
    expect(err2.code).toBe('not-host');

    expect(sockB.roomState?.room.gameType).toBeNull();

    await sockA.close();
    await sockB.close();
  });

  it('game cannot start until all players are ready', async () => {
    const a = await registerUser(baseUrl(), 'readycheck_a');
    const b = await registerUser(baseUrl(), 'readycheck_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:selectGame', { gameType: 'quiz' });
    await sockA.waitFor('room:update', (p) => (p as { room: { gameType: string } }).room.gameType === 'quiz');
    sockA.emit('room:start');

    const err = await sockA.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'players-not-ready');
    expect(err.code).toBe('players-not-ready');

    await sockA.close();
    await sockB.close();
  });
});

describe('Reaction game (action dedup + server-side timing)', () => {
  it('a duplicate click is rejected and round resolves once with a single winner', async () => {
    const a = await registerUser(baseUrl(), 'react_a');
    const b = await registerUser(baseUrl(), 'react_b');

    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    sockA.emit('room:join', { code });
    await sockA.waitFor('room:state', () => true);
    sockB.emit('room:join', { code });
    await sockB.waitFor('room:state', () => true);

    sockA.emit('room:ready', { ready: true });
    sockB.emit('room:ready', { ready: true });
    await sockA.waitFor('room:update', (p) =>
      (p as { players: { isReady: boolean }[] }).players.every((pl) => pl.isReady),
    );
    sockA.emit('room:selectGame', { gameType: 'reaction' });
    await sockA.waitFor('room:update', (p) => (p as { room: { gameType: string } }).room.gameType === 'reaction');
    sockA.emit('room:start');

    await sockA.waitFor<unknown>('game:state', (p) => (p as { phase: string }).phase === 'countdown');

    const awaiting = await sockA.waitFor<{ phase: string; signalAt: number | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'awaiting',
    );
    await sockB.waitFor<{ phase: string }>('game:state', (p) => (p as { phase: string }).phase === 'awaiting');
    expect(awaiting.signalAt).toBeTypeOf('number');

    sockA.emit('game:action', { type: 'click' });
    sockA.emit('game:action', { type: 'click' });

    const dupError = await sockA.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'already-clicked');
    expect(dupError.code).toBe('already-clicked');

    sockB.emit('game:action', { type: 'click' });

    const aResult = await sockA.waitFor<{ phase: string; roundTimes: Record<string, number | null>; roundWinner: string | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'result',
    );
    const bResult = await sockB.waitFor<{ phase: string; roundTimes: Record<string, number | null>; roundWinner: string | null }>(
      'game:state',
      (p) => (p as { phase: string }).phase === 'result',
    );
    expect(aResult.roundTimes[a.user.id]).toBeTypeOf('number');
    expect(aResult.roundTimes[b.user.id]).toBeTypeOf('number');
    expect(bResult.roundTimes).toEqual(aResult.roundTimes);
    expect([a.user.id, b.user.id]).toContain(aResult.roundWinner);

    await sockA.close();
    await sockB.close();
  });
});
