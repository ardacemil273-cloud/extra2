import type { Request, Response } from 'express';
import { z } from 'zod';
import { Router } from 'express';
import { prisma } from '../prisma';
import { requireAuth } from '../middleware/auth';
import { getAllRooms } from '../socket/store';
import { clientUrl } from '../utils/clientUrl';
import {
  ACHIEVEMENTS,
  ensureDailyChallenges,
  ensureAchievements,
  xpForLevel,
  computeLevel,
  claimDailyReward,
} from '../social/achievements';
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
  createNotification,
} from '../social/notifications';
import { censor } from '../utils/profanity';
import { getSeasonStatus, claimSeasonTitle } from '../social/seasons';
import { referralLink } from '../social/referral';

const router = Router();

function userPublic(u: { id: string; username: string; avatarColor: string; avatarUrl: string | null; title?: string; xp: number; level: number; dailyStreak: number }) {
  return {
    id: u.id,
    username: u.username,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl,
    title: u.title ?? '',
    xp: u.xp,
    level: u.level,
    dailyStreak: u.dailyStreak,
  };
}

function liveRoomForUser(userId: string) {
  for (const room of getAllRooms()) {
    if (room.players.has(userId) || room.spectators.has(userId)) {
      return {
        id: room.id,
        code: room.code,
        name: room.name,
        status: room.status,
        gameType: room.gameType,
        playerCount: room.players.size,
      };
    }
  }
  return null;
}

router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.authUser!.sub },
    select: { id: true, username: true, avatarColor: true, avatarUrl: true, xp: true, level: true, dailyStreak: true },
  });
  if (!user) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const level = user.level;
  const xpIntoLevel = user.xp - totalXpForLevel(level - 1);
  const needed = xpForLevel(level);
  res.json({
    user: userPublic(user),
    progress: { xpIntoLevel, needed, level },
  });
});

function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevel(i);
  return total;
}

router.get('/friends', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.sub;
  const [outgoing, incoming] = await Promise.all([
    prisma.friend.findMany({
      where: { userId, status: 'accepted' },
      include: {
        friend: { select: { id: true, username: true, avatarColor: true, avatarUrl: true, xp: true, level: true } },
      },
    }),
    prisma.friend.findMany({
      where: { friendId: userId, status: 'accepted' },
      include: {
        user: { select: { id: true, username: true, avatarColor: true, avatarUrl: true, xp: true, level: true } },
      },
    }),
  ]);
  const acceptedMap = new Map<string, { id: string; username: string; avatarColor: string; avatarUrl: string | null; xp: number; level: number }>();
  for (const f of outgoing) acceptedMap.set(f.friendId, f.friend);
  for (const f of incoming) acceptedMap.set(f.userId, f.user);
  const pendingRequests = await prisma.friend.findMany({
    where: { friendId: userId, status: 'pending' },
    include: { user: { select: { id: true, username: true, avatarColor: true, avatarUrl: true } } },
  });
  const friends = Array.from(acceptedMap.values()).map((f) => ({
    ...f,
    playing: liveRoomForUser(f.id),
  }));
  res.json({ friends, requests: pendingRequests.map((r) => r.user) });
});

router.post('/friends', requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ username: z.string().min(3).max(20) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid username.' });
    return;
  }
  const target = await prisma.user.findUnique({ where: { username: parsed.data.username.trim() } });
  if (!target) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const userId = req.authUser!.sub;
  if (target.id === userId) {
    res.status(400).json({ error: 'validation', message: 'You cannot add yourself.' });
    return;
  }
  const existing = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId, friendId: target.id },
        { userId: target.id, friendId: userId },
      ],
    },
  });
  if (existing) {
    res.status(409).json({ error: 'conflict', message: 'Friend request already exists.' });
    return;
  }
  await prisma.friend.create({ data: { userId, friendId: target.id, status: 'pending' } });
  await createNotification(target.id, 'friend_request', {
    fromId: userId,
    fromName: req.authUser!.username,
  }, userId);
  res.status(201).json({ ok: true });
});

router.post('/friends/:id/accept', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.sub;
  const friendId = req.params.id;
  const existing = await prisma.friend.findFirst({
    where: { userId: friendId, friendId: userId, status: 'pending' },
  });
  if (!existing) {
    res.status(404).json({ error: 'not-found', message: 'Request not found.' });
    return;
  }
  await prisma.friend.update({
    where: { id: existing.id },
    data: { status: 'accepted' },
  });
  const { awardAchievement } = await import('../social/achievements');
  await awardAchievement(userId, 'friend_add');
  await awardAchievement(friendId, 'friend_add');
  await createNotification(friendId, 'friend_accepted', {
    fromId: userId,
    fromName: req.authUser!.username,
  }, userId);
  res.json({ ok: true });
});

router.delete('/friends/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.sub;
  const friendId = req.params.id;
  const existing = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
    },
  });
  if (existing) {
    await prisma.friend.delete({ where: { id: existing.id } });
  }
  res.json({ ok: true });
});

router.get('/season', requireAuth, async (req: Request, res: Response) => {
  const status = await getSeasonStatus(req.authUser!.sub);
  res.json({ ...status, tiers: status.season.tiers });
});

router.post('/season/claim-title', requireAuth, async (req: Request, res: Response) => {
  const result = await claimSeasonTitle(req.authUser!.sub);
  res.json(result);
});

router.get('/referral', requireAuth, async (req: Request, res: Response) => {
  const code = await referralLink(req.authUser!.sub);
  const user = await prisma.user.findUnique({
    where: { id: req.authUser!.sub },
    select: { invitesAccepted: true, username: true },
  });
  res.json({ code, url: code ? clientUrl(req, `/register?ref=${code}`) : null, invitesAccepted: user?.invitesAccepted ?? 0, username: user?.username });
});

const profileUpdateSchema = z.object({
  bio: z.string().max(240).optional(),
  title: z.string().max(40).optional(),
  interests: z.array(z.string().max(20)).max(8).optional(),
});

router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid profile update.' });
    return;
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.bio !== undefined) data.bio = censor(parsed.data.bio).slice(0, 240);
  if (parsed.data.interests !== undefined) data.interests = parsed.data.interests.slice(0, 8);
  if (parsed.data.title !== undefined) {
    const user = await prisma.user.findUnique({
      where: { id: req.authUser!.sub },
      select: { unlockedTitles: true },
    });
    if (!user || !user.unlockedTitles.includes(parsed.data.title)) {
      res.status(403).json({ error: 'forbidden', message: 'You have not unlocked that title.' });
      return;
    }
    data.title = parsed.data.title;
  }
  const updated = await prisma.user.update({
    where: { id: req.authUser!.sub },
    data,
    select: { id: true, title: true, bio: true, interests: true, unlockedTitles: true },
  });
  res.json({ profile: updated });
});

router.get('/users/:username', requireAuth, async (req: Request, res: Response) => {
  const username = req.params.username;
  const viewerId = req.authUser!.sub;
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      avatarColor: true,
      avatarUrl: true,
      title: true,
      bio: true,
      interests: true,
      xp: true,
      level: true,
      dailyStreak: true,
      createdAt: true,
      _count: { select: { gameResults: true } },
    },
  });
  if (!user) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const wins = await prisma.gameResult.count({ where: { userId: user.id, placed: 1 } });
  const gameRows = await prisma.gameHistory.groupBy({
    by: ['gameType'],
    where: { results: { some: { userId: user.id } } },
    _count: { _all: true },
    orderBy: { _count: { gameType: 'desc' } },
    take: 1,
  });
  const recent = await prisma.gameResult.findMany({
    where: { userId: user.id },
    orderBy: { gameHistory: { playedAt: 'desc' } },
    take: 8,
    include: { gameHistory: { select: { roomName: true, gameType: true, playedAt: true } } },
  });
  const achievements = await prisma.userAchievement.findMany({
    where: { userId: user.id },
    select: { achievement: { select: { key: true, name: true, icon: true, xpReward: true } } },
  });
  const friendship = await prisma.friend.findFirst({
    where: {
      OR: [
        { userId: viewerId, friendId: user.id },
        { userId: user.id, friendId: viewerId },
      ],
    },
  });
  const me = viewerId === user.id;
  res.json({
    profile: {
      id: user.id,
      username: user.username,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      title: user.title,
      bio: user.bio,
      interests: user.interests,
      xp: user.xp,
      level: user.level,
      dailyStreak: user.dailyStreak,
      createdAt: user.createdAt,
      gamesPlayed: user._count.gameResults,
      wins,
      winRate: user._count.gameResults > 0 ? Math.round((wins / user._count.gameResults) * 100) : 0,
      favoriteGame: gameRows.length > 0 ? gameRows[0].gameType : null,
      recentGames: recent.map((r) => ({
        roomName: r.gameHistory.roomName,
        gameType: r.gameHistory.gameType,
        playedAt: r.gameHistory.playedAt,
        score: r.score,
        placed: r.placed,
      })),
      achievements: achievements.map((a) => a.achievement),
      isFriend: !me && friendship?.status === 'accepted',
      hasPendingRequest: !me && friendship?.status === 'pending' && friendship.userId === viewerId,
    },
    isMe: me,
  });
});

router.get('/leaderboard', requireAuth, async (_req: Request, res: Response) => {
  const top = await prisma.user.findMany({
    orderBy: [{ xp: 'desc' }, { level: 'desc' }],
    take: 20,
    select: { id: true, username: true, avatarColor: true, avatarUrl: true, xp: true, level: true, dailyStreak: true },
  });
  res.json({ leaderboard: top.map(userPublic) });
});

router.get('/achievements', requireAuth, async (req: Request, res: Response) => {
  await ensureAchievements();
  const earned = await prisma.userAchievement.findMany({
    where: { userId: req.authUser!.sub },
    include: { achievement: true },
  });
  const earnedKeys = new Set(earned.map((e) => e.achievement.key));
  const achievements = ACHIEVEMENTS.map((a) => ({
    ...a,
    earned: earnedKeys.has(a.key),
    earnedAt: earned.find((e) => e.achievement.key === a.key)?.earnedAt ?? null,
  }));
  res.json({ achievements });
});

router.get('/history', requireAuth, async (req: Request, res: Response) => {
  const results = await prisma.gameResult.findMany({
    where: { userId: req.authUser!.sub },
    orderBy: { gameHistory: { playedAt: 'desc' } },
    take: 30,
    include: { gameHistory: { select: { roomName: true, gameType: true, playedAt: true } } },
  });
  res.json({
    history: results.map((r) => ({
      id: r.id,
      roomName: r.gameHistory.roomName,
      gameType: r.gameHistory.gameType,
      playedAt: r.gameHistory.playedAt,
      score: r.score,
      placed: r.placed,
    })),
  });
});

router.get('/challenges', requireAuth, async (req: Request, res: Response) => {
  await ensureDailyChallenges();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const challenges = await prisma.dailyChallenge.findMany({ where: { day: today } });
  const progress = await prisma.userDailyProgress.findMany({
    where: { userId: req.authUser!.sub },
  });
  const byChallenge = new Map(progress.map((p) => [p.challengeId, p]));
  const user = await prisma.user.findUnique({
    where: { id: req.authUser!.sub },
    select: { dailyStreak: true },
  });
  res.json({
    streak: user?.dailyStreak ?? 0,
    challenges: challenges.map((c) => {
      const p = byChallenge.get(c.id);
      return {
        id: c.id,
        key: c.key,
        description: c.description,
        target: c.target,
        xpReward: c.xpReward,
        progress: p?.progress ?? 0,
        completed: p?.completed ?? false,
      };
    }),
  });
});

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.authUser!.sub },
    select: { id: true, username: true, avatarColor: true, avatarUrl: true, xp: true, level: true, dailyStreak: true },
  });
  if (!user) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const computed = computeLevel(user.xp);
  const level = computed;
  const totalBefore = totalXpForLevel(level - 1);
  res.json({
    user: userPublic(user),
    progress: { xpIntoLevel: user.xp - totalBefore, needed: xpForLevel(level), level },
  });
});

router.post('/claim-daily', requireAuth, async (req: Request, res: Response) => {
  const result = await claimDailyReward(req.authUser!.sub);
  res.json(result);
});

router.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const [notifications, unread] = await Promise.all([
    listNotifications(req.authUser!.sub),
    unreadNotificationCount(req.authUser!.sub),
  ]);
  res.json({ notifications, unread });
});

router.post('/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ ids: z.array(z.string()).optional() }).safeParse(req.body);
  await markNotificationsRead(req.authUser!.sub, parsed.success ? parsed.data.ids : undefined);
  res.json({ ok: true });
});

const REPORT_REASONS = [
  'abusive-language',
  'harassment',
  'spam',
  'inappropriate-content',
  'cheating',
  'other',
];

router.post('/report', requireAuth, async (req: Request, res: Response) => {
  const parsed = z
    .object({
      targetUserId: z.string().min(1).max(64),
      reason: z.string().min(1).max(32),
      details: z.string().max(500).optional(),
      roomId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation', message: 'Invalid report.' });
    return;
  }
  const userId = req.authUser!.sub;
  const { targetUserId, reason, roomId } = parsed.data;
  if (targetUserId === userId) {
    res.status(400).json({ error: 'validation', message: 'You cannot report yourself.' });
    return;
  }
  if (!REPORT_REASONS.includes(reason)) {
    res.status(400).json({ error: 'validation', message: 'Invalid report reason.' });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    res.status(404).json({ error: 'not-found', message: 'User not found.' });
    return;
  }
  const recent = await prisma.report.count({
    where: { reporterId: userId, createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } },
  });
  if (recent >= 5) {
    res.status(429).json({ error: 'rate-limited', message: 'Too many reports. Please wait.' });
    return;
  }
  const details = parsed.data.details ? censor(parsed.data.details).slice(0, 500) : null;
  await prisma.report.create({
    data: {
      reporterId: userId,
      targetUserId,
      roomId: roomId ?? null,
      reason,
      details: details ? { text: details } : undefined,
    },
  });
  res.status(201).json({ ok: true });
});

const GAME_TYPE_LABELS: Record<string, string> = {
  quiz: 'Brain Battle',
  reaction: 'Fastest Finger',
  rps: 'RPS Battle Royale',
  draw: 'Draw & Guess',
  telephone: 'Telephone',
  sabotaj: 'Sabotaj',
};

router.get('/recommendations', requireAuth, async (req: Request, res: Response) => {
  const userId = req.authUser!.sub;
  const results = await prisma.gameResult.findMany({
    where: { userId },
    select: { gameHistory: { select: { gameType: true } } },
  });
  const countByType: Record<string, number> = {};
  for (const r of results) {
    const t = r.gameHistory.gameType;
    countByType[t] = (countByType[t] ?? 0) + 1;
  }
  const popular = await prisma.gameHistory.groupBy({
    by: ['gameType'],
    orderBy: { _count: { gameType: 'desc' } },
    _count: { _all: true },
    take: 6,
  });
  const popularCounts: Record<string, number> = {};
  for (const row of popular) {
    popularCounts[row.gameType] = row._count._all;
  }
  const playedTypes = Object.keys(countByType);
  const neverPlayed = Object.keys(GAME_TYPE_LABELS).filter((t) => !playedTypes.includes(t));
  const recs: { type: string; label: string; reason: string; popular: number }[] = [];
  for (const t of neverPlayed) {
    recs.push({ type: t, label: GAME_TYPE_LABELS[t], reason: 'You have not tried this yet', popular: popularCounts[t] ?? 0 });
  }
  const sortedPopular = Object.entries(popularCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [type, count] of sortedPopular) {
    if (!recs.some((r) => r.type === type)) {
      recs.push({ type, label: GAME_TYPE_LABELS[type] ?? type, reason: 'The community loves it', popular: count });
    }
  }
  res.json({ recommendations: recs.slice(0, 5) });
});

export default router;
