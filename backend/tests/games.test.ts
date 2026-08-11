import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestEnv, registerUser, createRoom, TestSocket, type TestEnv } from './helpers';
import type { RoomState } from '../src/types';

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

type GameState = {
  phase?: string;
  [key: string]: unknown;
};

async function joinRoom(sock: TestSocket, code: string): Promise<void> {
  sock.emit('room:join', { code });
  await sock.waitFor('room:state', () => true);
}

async function readyAndStart(socks: TestSocket[], gameType: string): Promise<void> {
  const host = socks[0];
  for (const sock of socks) {
    sock.emit('room:ready', { ready: true });
  }
  await host.waitFor<RoomState>('room:update', (p) =>
    (p as RoomState).players.every((pl) => pl.isReady),
  );
  host.emit('room:selectGame', { gameType });
  await host.waitFor<RoomState>('room:update', (p) => (p as RoomState).room.gameType === gameType);
  host.emit('room:start');
}

describe('RPS Battle Royale (server-authoritative state + actions)', () => {
  it('round resolves once with correct beat/lose/win outcomes and hidden choices during play', async () => {
    const a = await registerUser(baseUrl(), 'rps_game_a');
    const b = await registerUser(baseUrl(), 'rps_game_b');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await readyAndStart([sockA, sockB], 'rps');

    const round = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'round');
    expect(round.type).toBe('rps');
    expect((round.players as Record<string, { currentChoice: unknown }>)[a.user.id].currentChoice).toBeNull();

    sockA.emit('game:action', { type: 'choose', payload: { choice: 'rock' } });
    sockB.emit('game:action', { type: 'choose', payload: { choice: 'scissors' } });

    const reveal = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'reveal');
    const outcomes = reveal.outcomes as Record<string, { wins: string[]; loses: string[]; ties: string[] }>;
    expect(outcomes[a.user.id].wins).toContain(b.user.id);
    expect(outcomes[b.user.id].loses).toContain(a.user.id);
    expect(outcomes[a.user.id].loses).toHaveLength(0);
    expect((reveal.roundWinnerIds as string[]).length).toBeGreaterThan(0);
    expect((reveal.players as Record<string, { currentChoice: string | null }>)[a.user.id].currentChoice).toBe('rock');

    await sockA.close();
    await sockB.close();
  });
});

describe('Draw & Guess (hidden word + guesses)', () => {
  it('only the drawer sees the word, and a correct guess ends the round immediately', async () => {
    const a = await registerUser(baseUrl(), 'draw_game_a');
    const b = await registerUser(baseUrl(), 'draw_game_b');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await readyAndStart([sockA, sockB], 'draw');

    const aDrawingP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'drawing');
    const bDrawingP = sockB.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'drawing');
    await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'countdown');
    await sockB.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'countdown');
    const aDrawing = await aDrawingP;
    const bDrawing = await bDrawingP;

    expect(aDrawing.drawerId).toBe(a.user.id);
    const word = aDrawing.word as string;
    expect(typeof word).toBe('string');
    expect(word.length).toBeGreaterThan(1);
    // The drawer sees the word but the guesser does not.
    expect(bDrawing.word).toBeNull();

    // Drawer can emit strokes; guesser cannot.
    const strokeReceived = sockB.waitFor('game:stroke', () => true);
    sockA.emit('game:action', {
      type: 'stroke',
      payload: { points: [{ x: 0.1, y: 0.2 }], color: '#000000', size: 4, tool: 'pen' },
    });
    sockB.emit('game:action', {
      type: 'stroke',
      payload: { points: [{ x: 0.1, y: 0.2 }] },
    });
    const notDrawerErr = await sockB.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'not-drawer');
    expect(notDrawerErr.code).toBe('not-drawer');
    await strokeReceived;

    // Wrong guess does not end the round (no reveal is broadcast; it is silently ignored).
    sockB.emit('game:action', { type: 'guess', payload: { text: 'totally-not-it' } });

    // Correct guess by the only guesser ends the round immediately (reveal).
    const aRevealP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'reveal');
    const revealGuessP = sockB.waitFor<{ userId: string; points: number }>('game:revealGuess', () => true);
    sockB.emit('game:action', { type: 'guess', payload: { text: word } });
    const aReveal = await aRevealP;
    expect(aReveal.word).toBe(word);
    const revealGuess = await revealGuessP;
    expect(revealGuess.points).toBeGreaterThan(0);

    await sockA.close();
    await sockB.close();
  });
});

describe('Telephone (chain of prompt → draw → caption)', () => {
  it('players submit a prompt and the chain advances to the next step', async () => {
    const a = await registerUser(baseUrl(), 'tel_game_a');
    const b = await registerUser(baseUrl(), 'tel_game_b');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await readyAndStart([sockA, sockB], 'telephone');

    const prompt = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'prompt');
    expect(prompt.kind).toBe('prompt');

    sockA.emit('game:action', { type: 'submitText', payload: { text: 'A cat riding a rocket' } });
    sockB.emit('game:action', { type: 'submitText', payload: { text: 'Penguins at a disco' } });

    const draw = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'draw');
    expect(draw.kind).toBe('draw');
    expect((draw.page as { history: unknown[] }).history.length).toBe(1);

    await sockA.close();
    await sockB.close();
  });
});

describe('Sabotaj (hidden roles + station actions)', () => {
  it('assigns exactly one hidden saboteur and hides roles from other players', async () => {
    const a = await registerUser(baseUrl(), 'sab_game_a');
    const b = await registerUser(baseUrl(), 'sab_game_b');
    const c = await registerUser(baseUrl(), 'sab_game_c');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    const sockC = new TestSocket(baseUrl(), c.token);
    await sockA.connect();
    await sockB.connect();
    await sockC.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await joinRoom(sockC, code);
    await readyAndStart([sockA, sockB, sockC], 'sabotaj');

    const aAction = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'action');
    const bAction = await sockB.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'action');
    const cAction = await sockC.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'action');

    const roleA = (aAction.me as { role: string | null }).role;
    const roleB = (bAction.me as { role: string | null }).role;
    const roleC = (cAction.me as { role: string | null }).role;

    const saboteurs = [roleA, roleB, roleC].filter((r) => r === 'saboteur').length;
    expect(saboteurs).toBe(1);
    // Public snapshot never leaks a live player's hidden role.
    const publicPlayers = aAction.players as Record<string, { role: string | null }>;
    for (const userId of Object.keys(publicPlayers)) {
      expect(publicPlayers[userId].role).toBeNull();
    }

    // Everyone picks a station; the round resolves into the result phase.
    for (const [i, sock] of [sockA, sockB, sockC].entries()) {
      sock.emit('game:action', { type: 'pick', payload: { station: i } });
    }
    const result = await sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'result');
    expect((result.stations as { fixed: boolean; sabotaged: boolean }[]).length).toBe(5);

    await sockA.close();
    await sockB.close();
    await sockC.close();
  });
});

describe('Chameleon (hidden role + clue order + vote)', () => {
  it('gives everyone the same public state, hides the word from the chameleon, and resolves a caught vote', async () => {
    const a = await registerUser(baseUrl(), 'cham_game_a');
    const b = await registerUser(baseUrl(), 'cham_game_b');
    const c = await registerUser(baseUrl(), 'cham_game_c');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    const sockC = new TestSocket(baseUrl(), c.token);
    await sockA.connect();
    await sockB.connect();
    await sockC.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await joinRoom(sockC, code);
    await readyAndStart([sockA, sockB, sockC], 'chameleon');

    const clueStates = await Promise.all(
      [sockA, sockB, sockC].map((s) =>
        s.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'clue' && (p as { currentClueId: string | null }).currentClueId !== null),
      ),
    );

    // Exactly one player is the chameleon; only non-chameleons see the word.
    const chameleons = clueStates.filter((s) => (s.me as { isChameleon: boolean }).isChameleon);
    expect(chameleons.length).toBe(1);
    expect((chameleons[0].me as { word: string | null }).word).toBeNull();
    for (const s of clueStates) {
      if (!(s.me as { isChameleon: boolean }).isChameleon) {
        expect((s.me as { word: string | null }).word).toBeTruthy();
      }
      // Public snapshot never reveals the chameleon or the word.
      expect((s as unknown as { chameleonId: string | null }).chameleonId).toBeNull();
      expect((s as unknown as { word: string | null }).word).toBeNull();
    }

    // Submitting out of turn is rejected.
    const clueOrder = clueStates[0].clueOrder as string[];
    const byId: Record<string, TestSocket> = { [a.user.id]: sockA, [b.user.id]: sockB, [c.user.id]: sockC };
    const notTurn = clueOrder[1];
    const errP = byId[notTurn].waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'not-your-turn');
    byId[notTurn].emit('game:action', { type: 'clue', payload: { text: 'sneaky early clue' } });
    expect((await errP).code).toBe('not-your-turn');

    // Everyone submits a clue in turn order; the last one flips the phase to vote.
    // The first player's turn is already active, so start from the current clue giver.
    const voteP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'vote');
    let turn = clueStates[0].currentClueId as string;
    for (let i = 0; i < clueOrder.length; i++) {
      byId[turn].emit('game:action', { type: 'clue', payload: { text: `clue ${i}` } });
      if (i < clueOrder.length - 1) {
        const next = await sockA.waitFor<GameState>(
          'game:state',
          (p) => (p as GameState).phase === 'clue' && (p as { currentClueId: string }).currentClueId !== turn,
        );
        turn = next.currentClueId as string;
      }
    }
    await voteP;

    // Voting for yourself is rejected.
    const selfErrP = sockA.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'invalid-target');
    sockA.emit('game:action', { type: 'vote', payload: { targetId: a.user.id } });
    expect((await selfErrP).code).toBe('invalid-target');

    // Everyone votes; the round resolves into reveal with a decided outcome.
    const revealP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'reveal');
    for (const pid of clueOrder) {
      const target = clueOrder.find((o) => o !== pid)!;
      byId[pid].emit('game:action', { type: 'vote', payload: { targetId: target } });
    }
    const reveal = await revealP;
    expect(reveal.votesByTarget).toBeTruthy();
    expect(typeof reveal.caught).toBe('boolean');

    await sockA.close();
    await sockB.close();
    await sockC.close();
  });
});

describe('Reveal (answer + vote + vibe deck)', () => {
  it('picks a question, hides answers until voting, and crowns a winner', async () => {
    const a = await registerUser(baseUrl(), 'rev_game_a');
    const b = await registerUser(baseUrl(), 'rev_game_b');
    const room = await createRoom(baseUrl(), a.token);
    const code = room.room.code;

    const sockA = new TestSocket(baseUrl(), a.token);
    const sockB = new TestSocket(baseUrl(), b.token);
    await sockA.connect();
    await sockB.connect();
    await joinRoom(sockA, code);
    await joinRoom(sockB, code);
    await readyAndStart([sockA, sockB], 'reveal');

    const qStates = await Promise.all(
      [sockA, sockB].map((s) => s.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'question')),
    );
    expect(qStates[0].deck).toBe('mixed');
    expect(qStates[0].question).toBeTruthy();
    // Answers are hidden from the public snapshot during the question phase.
    const players = qStates[0].players as Record<string, { answer: string | null }>;
    for (const userId of Object.keys(players)) {
      expect(players[userId].answer).toBeNull();
    }

    // Empty answer is rejected.
    const emptyErrP = sockA.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'invalid-answer');
    sockA.emit('game:action', { type: 'submit', payload: { text: '   ' } });
    expect((await emptyErrP).code).toBe('invalid-answer');

    // Both answer; last answer flips to vote phase.
    const voteP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'vote');
    sockA.emit('game:action', { type: 'submit', payload: { text: 'A majestic cat juggling cheese' } });
    sockB.emit('game:action', { type: 'submit', payload: { text: 'My mirror, after a good hair day' } });
    await voteP;

    // Reveal shows both answers and a winner (votes cannot be self-targeted).
    const revealP = sockA.waitFor<GameState>('game:state', (p) => (p as GameState).phase === 'reveal');
    sockA.emit('game:action', { type: 'vote', payload: { targetId: b.user.id } });
    sockB.emit('game:action', { type: 'vote', payload: { targetId: a.user.id } });
    const reveal = await revealP;
    const revealed = reveal.players as Record<string, { answer: string | null }>;
    expect(revealed[a.user.id].answer).toBeTruthy();
    expect(revealed[b.user.id].answer).toBeTruthy();
    expect((reveal.winnerIds as string[]).length).toBeGreaterThan(0);

    await sockA.close();
    await sockB.close();
  });
});
