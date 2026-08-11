import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startTestEnv, registerUser, type TestEnv } from './helpers';
import { prisma } from '../src/prisma';
import { ensureAchievements } from '../src/social/achievements';
import { markReferralPlayed } from '../src/social/referral';
import { grantSeasonXp } from '../src/social/seasons';

let env: TestEnv;

beforeAll(async () => {
  env = await startTestEnv();
  await ensureAchievements();
});

afterAll(async () => {
  await env.cleanup();
});

describe('referral codes', () => {
  it('registers with a referral code, links the invitee, and awards the referrer on first game', async () => {
    const referrer = (await registerUser(env.baseUrl, 'ref_referrer')) as {
      token: string;
      user: { id: string; username: string };
    };

    const referral = await request(env.baseUrl).get('/api/social/referral').set('Authorization', `Bearer ${referrer.token}`);
    expect(referral.status).toBe(200);
    expect(referral.body.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(referral.body.url).toContain('ref=');

    const before = await prisma.user.findUnique({ where: { id: referrer.user.id }, select: { xp: true, invitesAccepted: true } });

    const inviteeRes = await request(env.baseUrl)
      .post('/api/auth/register')
      .send({
        username: 'ref_invitee',
        email: 'ref_invitee@test.partyverse',
        password: 'password123',
        referralCode: referral.body.code,
      });
    expect(inviteeRes.status).toBe(201);
    const inviteeId = inviteeRes.body.user.id as string;

    const linked = await prisma.user.findUnique({ where: { id: inviteeId }, select: { invitedBy: true } });
    expect(linked?.invitedBy).toBe(referrer.user.id);

    // No reward before the invitee plays.
    await markReferralPlayed(inviteeId);
    const afterFirst = await prisma.user.findUnique({ where: { id: referrer.user.id }, select: { xp: true, invitesAccepted: true } });
    expect(afterFirst?.xp).toBe((before?.xp ?? 0) + 100);
    expect(afterFirst?.invitesAccepted).toBe(1);

    // Second call is a no-op (already rewarded).
    await markReferralPlayed(inviteeId);
    const afterSecond = await prisma.user.findUnique({ where: { id: referrer.user.id }, select: { xp: true, invitesAccepted: true } });
    expect(afterSecond?.xp).toBe(afterFirst?.xp);
    expect(afterSecond?.invitesAccepted).toBe(1);

    const refAchievement = await prisma.userAchievement.findFirst({
      where: { userId: referrer.user.id, achievement: { key: 'referral_1' } },
    });
    expect(refAchievement).toBeTruthy();
  });
});

describe('season system', () => {
  it('reports tier progress and unlocks titles + tier achievements on tier-up', async () => {
    const player = (await registerUser(env.baseUrl, 'season_player')) as { token: string; user: { id: string } };

    const before = await request(env.baseUrl).get('/api/social/season').set('Authorization', `Bearer ${player.token}`);
    expect(before.status).toBe(200);
    expect(before.body.tier.name).toBe('Rookie');
    expect(before.body.tiers.length).toBe(5);

    // Push well past the Legend threshold so every tier unlocks at once.
    const result = await grantSeasonXp(player.user.id, 1200);
    expect(result.newTier).toBe('Legend');

    const after = await request(env.baseUrl).get('/api/social/season').set('Authorization', `Bearer ${player.token}`);
    expect(after.body.tier.name).toBe('Legend');
    expect(after.body.unlockedTitle).toBe('Season Legend');

    for (const key of ['season_tier_2', 'season_tier_4']) {
      const ach = await prisma.userAchievement.findFirst({
        where: { userId: player.user.id, achievement: { key } },
      });
      expect(ach).toBeTruthy();
    }

    // Claiming the season title sets it on the profile.
    const claim = await request(env.baseUrl)
      .post('/api/social/season/claim-title')
      .set('Authorization', `Bearer ${player.token}`);
    expect(claim.status).toBe(200);
    expect(claim.body.title).toBe('Season Legend');
  });
});

describe('profile customization', () => {
  it('rejects titles you have not unlocked and accepts unlocked ones', async () => {
    const player = (await registerUser(env.baseUrl, 'profile_player')) as { token: string; user: { id: string } };

    const forbidden = await request(env.baseUrl)
      .put('/api/social/profile')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ title: 'Party Royalty' });
    expect(forbidden.status).toBe(403);

    await grantSeasonXp(player.user.id, 1200);
    const ok = await request(env.baseUrl)
      .put('/api/social/profile')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ title: 'Season Legend', bio: 'Here for the vibes', interests: ['party', 'memes', 'drawing'] });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.title).toBe('Season Legend');
    expect(ok.body.profile.bio).toBe('Here for the vibes');
    expect(ok.body.profile.interests).toEqual(['party', 'memes', 'drawing']);
  });
});

describe('public user profile', () => {
  it('returns a public profile with stats for a given username', async () => {
    const viewer = (await registerUser(env.baseUrl, 'pub_viewer')) as { token: string };
    const target = (await registerUser(env.baseUrl, 'pub_target')) as { user: { username: string; id: string } };

    const res = await request(env.baseUrl)
      .get(`/api/social/users/${target.user.username}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.username).toBe(target.user.username);
    expect(res.body.profile.gamesPlayed).toBe(0);
    expect(res.body.profile.winRate).toBe(0);
    expect(res.body.isMe).toBe(false);

    const missing = await request(env.baseUrl)
      .get('/api/social/users/no_such_user_xyz')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(missing.status).toBe(404);
  });
});
