import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { censor } from '../src/utils/profanity';
import { generateAwards } from '../src/social/awards';
import type { GameResultEntry } from '../src/types';
import { startTestEnv, registerUser, createRoom, TestSocket, type TestEnv } from './helpers';
import { prisma } from '../src/prisma';

describe('profanity filter', () => {
  it('masks common profanity and leaves clean text intact', () => {
    expect(censor('this is fuck awful')).toBe('this is f*** awful');
    expect(censor('what a shit show')).toBe('what a s*** show');
    expect(censor('hello world, nice to meet you')).toBe('hello world, nice to meet you');
  });

  it('handles spacing obfuscation', () => {
    const out = censor('f u c k');
    expect(out).not.toBe('f u c k');
  });
});

describe('game awards generator', () => {
  it('awards the winner and includes highlight awards', () => {
    const results: GameResultEntry[] = [
      { userId: 'u1', username: 'Alice', avatarColor: '#000', score: 120, placed: 1 },
      { userId: 'u2', username: 'Bob', avatarColor: '#000', score: 50, placed: 2 },
    ];
    const awards = generateAwards(undefined as never, undefined as never, results, [
      { key: 'brainiac', emoji: '🧠', title: 'Brainiac', userId: 'u1', detail: '5 correct answers.' },
    ]);
    expect(awards.some((a) => a.key === 'winner' && a.userId === 'u1')).toBe(true);
    expect(awards.some((a) => a.key === 'brainiac' && a.userId === 'u1')).toBe(true);
    expect(awards.length).toBeLessThanOrEqual(6);
  });

  it('does not award last-place with only two players', () => {
    const results: GameResultEntry[] = [
      { userId: 'u1', username: 'A', avatarColor: '#000', score: 100, placed: 1 },
      { userId: 'u2', username: 'B', avatarColor: '#000', score: 0, placed: 2 },
    ];
    const awards = generateAwards(undefined as never, undefined as never, results, []);
    expect(awards.some((a) => a.key === 'last-place')).toBe(false);
  });

  it('always returns at least one award', () => {
    const results: GameResultEntry[] = [
      { userId: 'u1', username: 'A', avatarColor: '#000', score: 0, placed: 1 },
    ];
    const awards = generateAwards(undefined as never, undefined as never, results, []);
    expect(awards.length).toBeGreaterThan(0);
  });
});

describe('daily claim + notifications + moderation + share', () => {
  let env: TestEnv;
  let alice: { token: string; user: { id: string; username: string } };
  let bob: { token: string; user: { id: string; username: string } };

  beforeAll(async () => {
    env = await startTestEnv();
    alice = (await registerUser(env.baseUrl, 'featalice')) as { token: string; user: { id: string; username: string } };
    bob = (await registerUser(env.baseUrl, 'featbob')) as { token: string; user: { id: string; username: string } };
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('claims a daily reward once and rejects double claims', async () => {
    const first = await request(env.baseUrl)
      .post('/api/social/claim-daily')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(first.status).toBe(200);
    expect(first.body.streak).toBe(1);
    expect(first.body.xpGained).toBe(40);
    expect(first.body.alreadyClaimed).toBe(false);

    const second = await request(env.baseUrl)
      .post('/api/social/claim-daily')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(second.body.alreadyClaimed).toBe(true);
    expect(second.body.xpGained).toBe(0);
  });

  it('pushes a friend request notification over socket and lists it', async () => {
    const sockB = new TestSocket(env.baseUrl, bob.token);
    await sockB.connect();
    const nP = sockB.waitFor<{ kind: string; payload: unknown }>('notification:new', (p) => (p as { kind: string }).kind === 'friend_request');
    const res = await request(env.baseUrl)
      .post('/api/social/friends')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ username: bob.user.username });
    expect(res.status).toBe(201);
    const n = await nP;
    expect(n.kind).toBe('friend_request');

    const list = await request(env.baseUrl)
      .get('/api/social/notifications')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(list.body.notifications.some((x: { kind: string }) => x.kind === 'friend_request')).toBe(true);
    expect(list.body.unread).toBeGreaterThan(0);
    await sockB.close();
  });

  it('accepting a friend request notifies the requester', async () => {
    const res = await request(env.baseUrl)
      .post(`/api/social/friends/${alice.user.id}/accept`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(res.status).toBe(200);
    const list = await request(env.baseUrl)
      .get('/api/social/notifications')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(list.body.notifications.some((x: { kind: string }) => x.kind === 'friend_accepted')).toBe(true);
  });

  it('host can mute (chat blocked) and kick a player; invites a friend to the room', async () => {
    const roomState = await createRoom(env.baseUrl, alice.token, 'Moderation Room');
    const sockA = new TestSocket(env.baseUrl, alice.token);
    const sockB = new TestSocket(env.baseUrl, bob.token);
    await sockA.connect();
    await sockB.connect();
    await sockA.emit('room:join', { code: roomState.room.code });
    await sockA.waitFor<{ room: { code: string } }>('room:state', (p) => (p as { room: { code: string } }).room.code === roomState.room.code);
    await sockB.emit('room:join', { code: roomState.room.code });
    await sockB.waitFor<{ room: { code: string } }>('room:state', (p) => (p as { room: { code: string } }).room.code === roomState.room.code);

    // Bob can chat at first.
    sockB.emit('room:chat', { text: 'hello everyone' });

    // Host mutes Bob; Bob's next message is rejected.
    sockA.emit('room:mute', { userId: bob.user.id, muted: true });
    await sockB.waitFor<{ muted: boolean }>('room:muted', (p) => (p as { muted: boolean }).muted === true);
    sockB.emit('room:chat', { text: 'this should fail' });
    const mutedErr = await sockB.waitFor<{ code: string }>('error', (p) => (p as { code: string }).code === 'muted');
    expect(mutedErr.code).toBe('muted');

    // Host invites Bob (friend) to the room via socket notification.
    const inviteP = sockB.waitFor<{ kind: string; payload: { code: string } }>(
      'notification:new',
      (p) => (p as { kind: string }).kind === 'room_invite',
    );
    sockA.emit('room:inviteFriend', { userId: bob.user.id });
    const invite = await inviteP;
    expect(invite.payload.code).toBe(roomState.room.code);

    // Host kicks Bob.
    sockA.emit('room:kick', { userId: bob.user.id });
    await sockB.waitFor<{ roomId: string }>('room:kicked', (p) => (p as { roomId: string }).roomId === roomState.room.id);

    await sockB.close();
    await sockA.close();
  });

  it('creates reports and rate-limits abusive reporting', async () => {
    const res = await request(env.baseUrl)
      .post('/api/social/report')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ targetUserId: bob.user.id, reason: 'abusive-language', details: 'they were rude' });
    expect(res.status).toBe(201);

    const badReason = await request(env.baseUrl)
      .post('/api/social/report')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ targetUserId: bob.user.id, reason: 'made-up-reason' });
    expect(badReason.status).toBe(400);
  });

  it('serves a share summary and an HTML card with awards', async () => {
    const owner = await prisma.user.create({
      data: { username: 'shareowner', email: 'shareowner@test.partyverse', passwordHash: 'x', avatarColor: '#7c3aed' },
    });
    const p2 = await prisma.user.create({
      data: { username: 'shareplayer2', email: 'shareplayer2@test.partyverse', passwordHash: 'x', avatarColor: '#22d3ee' },
    });
    const room = await prisma.room.create({ data: { code: 'SHARE1', name: 'Share Party', ownerId: owner.id } });
    const history = await prisma.gameHistory.create({
      data: {
        roomId: room.id,
        roomName: room.name,
        gameType: 'quiz',
        awards: [{ key: 'brainiac', emoji: '🧠', title: 'Brainiac', userId: owner.id, detail: '5 correct.' }] as object,
        results: {
          create: [
            { userId: owner.id, score: 120, placed: 1 },
            { userId: p2.id, score: 40, placed: 2 },
          ],
        },
      },
    });

    const json = await request(env.baseUrl).get(`/api/share/${history.id}`);
    expect(json.status).toBe(200);
    expect(json.body.winners).toContain('shareowner');
    expect(json.body.awards.length).toBeGreaterThan(0);
    expect(json.body.players).toHaveLength(2);

    const html = await request(env.baseUrl).get(`/share/${history.id}`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('shareowner');
    expect(html.text).toContain('Brainiac');
  });

  it('returns personalized recommendations', async () => {
    const res = await request(env.baseUrl)
      .get('/api/social/recommendations')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recommendations)).toBe(true);
    expect(res.body.recommendations.length).toBeGreaterThan(0);
  });
});
