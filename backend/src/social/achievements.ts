import { prisma } from '../prisma';
import { emitToRoom, type LiveRoom } from '../socket/store';
import type { GameResultEntry } from '../types';
import { getGame } from '../games/registry';
import { createNotification } from './notifications';
import { grantSeasonXp, seasonXpForPlacement } from './seasons';
import { markReferralPlayed } from './referral';

const LEVEL_TITLES: Record<number, string> = {
  2: 'Fresh Face',
  4: 'Party Goer',
  6: 'Loyal Player',
  10: 'Party VIP',
  15: 'Party Legend',
  25: 'Party Royalty',
};

async function unlockLevelTitle(userId: string, level: number): Promise<string | null> {
  const title = LEVEL_TITLES[level];
  if (!title) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { unlockedTitles: true, title: true } });
  if (!user || user.unlockedTitles.includes(title)) return null;
  const unlocked = [...user.unlockedTitles, title];
  await prisma.user.update({
    where: { id: userId },
    data: { unlockedTitles: unlocked, title: user.title === '' ? title : user.title },
  });
  return title;
}

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_game', name: 'First Party', description: 'Play your very first game.', icon: '🎉', xpReward: 50 },
  { key: 'games_5', name: 'Getting Started', description: 'Play 5 games.', icon: '🎮', xpReward: 100 },
  { key: 'games_25', name: 'Party Animal', description: 'Play 25 games.', icon: '🥳', xpReward: 250 },
  { key: 'games_100', name: 'Party Legend', description: 'Play 100 games.', icon: '🏆', xpReward: 500 },
  { key: 'win_1', name: 'First Victory', description: 'Win your first game.', icon: '🥇', xpReward: 100 },
  { key: 'win_10', name: 'Champion', description: 'Win 10 games.', icon: '👑', xpReward: 300 },
  { key: 'game_quiz', name: 'Brainiac', description: 'Play Brain Battle.', icon: '🧠', xpReward: 75 },
  { key: 'game_reaction', name: 'Lightning', description: 'Play Fastest Finger.', icon: '⚡', xpReward: 75 },
  { key: 'game_rps', name: 'Strategist', description: 'Play RPS Battle Royale.', icon: '✊', xpReward: 75 },
  { key: 'game_draw', name: 'Picasso', description: 'Play Draw & Guess.', icon: '🎨', xpReward: 75 },
  { key: 'game_telephone', name: 'Storyteller', description: 'Play Telephone.', icon: '📞', xpReward: 75 },
  { key: 'game_sabotaj', name: 'Detective', description: 'Play Sabotaj.', icon: '🕵️', xpReward: 75 },
  { key: 'level_5', name: 'Level 5', description: 'Reach level 5.', icon: '⭐', xpReward: 200 },
  { key: 'level_10', name: 'Level 10', description: 'Reach level 10.', icon: '🌟', xpReward: 400 },
  { key: 'friend_add', name: 'Social Butterfly', description: 'Add your first friend.', icon: '🤝', xpReward: 50 },
  { key: 'streak_3', name: 'On Fire', description: 'Keep a 3-day streak.', icon: '🔥', xpReward: 150 },
  { key: 'streak_7', name: 'Addicted', description: 'Keep a 7-day streak.', icon: '⚡', xpReward: 300 },
  { key: 'streak_30', name: 'Party Legend', description: 'Keep a 30-day streak.', icon: '💎', xpReward: 800 },
  { key: 'game_chameleon', name: 'Undercover', description: 'Play Chameleon.', icon: '🦎', xpReward: 75 },
  { key: 'game_reveal', name: 'Open Book', description: 'Play Reveal.', icon: '💬', xpReward: 75 },
  { key: 'referral_1', name: 'Recruiter', description: 'Get a friend to join through your link.', icon: '📣', xpReward: 200 },
  { key: 'referral_5', name: 'Community Builder', description: 'Bring 5 friends to the party.', icon: '🏘️', xpReward: 800 },
  { key: 'season_tier_2', name: 'Season Regular', description: 'Reach Season Regular tier.', icon: '🥈', xpReward: 150 },
  { key: 'season_tier_4', name: 'Season Star', description: 'Reach Season Star tier.', icon: '⭐', xpReward: 500 },
];

export async function ensureAchievements(): Promise<void> {
  const existing = new Set((await prisma.achievement.findMany({ select: { key: true } })).map((a) => a.key));
  const missing = ACHIEVEMENTS.filter((a) => !existing.has(a.key));
  if (missing.length > 0) {
    await prisma.achievement.createMany({ data: missing });
  }
}

export function xpForLevel(level: number): number {
  return 150 + (level - 1) * 50;
}

export function computeLevel(totalXp: number): number {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return level;
}

export async function awardAchievement(
  userId: string,
  key: string,
): Promise<{ unlocked: boolean; xp: number }> {
  const def = ACHIEVEMENTS.find((a) => a.key === key);
  if (!def) return { unlocked: false, xp: 0 };
  const ach = await prisma.achievement.findUnique({ where: { key } });
  if (!ach) return { unlocked: false, xp: 0 };
  const existing = await prisma.userAchievement.findUnique({
    where: { userId_achievementId: { userId, achievementId: ach.id } },
  });
  if (existing) return { unlocked: false, xp: 0 };
  await prisma.userAchievement.create({
    data: { userId, achievementId: ach.id },
  });
  return { unlocked: true, xp: def.xpReward };
}

export interface AwardContext {
  userId: string;
  username: string;
  avatarColor: string;
  score: number;
  placed: number;
}

export interface GameReward extends GameResultEntry {
  xpGained: number;
  seasonXpGained: number;
  levelBefore: number;
  levelAfter: number;
  newAchievements: string[];
  newTitle?: string | null;
}

function placementXp(placed: number, total: number): number {
  if (total <= 1) return 40;
  if (placed === 1) return 80;
  if (placed === 2) return 45;
  if (placed === 3) return 25;
  if (placed === 4) return 15;
  return 10;
}

async function grantXp(userId: string, xp: number): Promise<{ levelBefore: number; levelAfter: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { levelBefore: 1, levelAfter: 1 };
  const totalXp = user.xp + xp;
  const levelAfter = computeLevel(totalXp);
  await prisma.user.update({
    where: { id: userId },
    data: { xp: totalXp, level: levelAfter },
  });
  return { levelBefore: user.level, levelAfter };
}

export async function applyDailyStreak(userIds: string[]): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  for (const userId of userIds) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastDailyAt: true, dailyStreak: true } });
    if (!user) continue;
    const last = user.lastDailyAt;
    let streak = user.dailyStreak;
    if (!last) {
      streak = 1;
    } else {
      const lastDay = new Date(last);
      lastDay.setHours(0, 0, 0, 0);
      if (lastDay.getTime() === today.getTime()) continue; // already counted today
      if (lastDay.getTime() === yesterday.getTime()) {
        streak += 1;
      } else {
        streak = 1;
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { dailyStreak: streak, lastDailyAt: today } });
    if (streak >= 3) {
      await awardAchievement(userId, 'streak_3');
    }
  }
}

export interface ClaimDailyResult {
  streak: number;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  alreadyClaimed: boolean;
  newAchievements: string[];
}

export async function claimDailyReward(userId: string): Promise<ClaimDailyResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xp: true, level: true, lastDailyAt: true, dailyStreak: true },
  });
  if (!user) {
    return { streak: 0, xpGained: 0, levelBefore: 1, levelAfter: 1, alreadyClaimed: true, newAchievements: [] };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last = user.lastDailyAt;
  let streak = user.dailyStreak;
  let alreadyClaimed = false;
  if (last) {
    const lastDay = new Date(last);
    lastDay.setHours(0, 0, 0, 0);
    if (lastDay.getTime() === today.getTime()) {
      alreadyClaimed = true;
    } else if (lastDay.getTime() === new Date(today.getTime() - 86400000).getTime()) {
      streak += 1;
    } else {
      streak = 1;
    }
  } else {
    streak = 1;
  }
  if (alreadyClaimed) {
    return { streak, xpGained: 0, levelBefore: user.level, levelAfter: user.level, alreadyClaimed: true, newAchievements: [] };
  }
  const xpGained = 40 + (streak - 1) * 10;
  const totalXp = user.xp + xpGained;
  const levelAfter = computeLevel(totalXp);
  await prisma.user.update({
    where: { id: userId },
    data: { xp: totalXp, level: levelAfter, dailyStreak: streak, lastDailyAt: new Date() },
  });
  const newAchievements: string[] = [];
  for (const key of ['streak_3', 'streak_7', 'streak_30'] as const) {
    const target = Number(key.split('_')[1]);
    if (streak >= target) {
      const res = await awardAchievement(userId, key);
      if (res.unlocked) newAchievements.push(key);
    }
  }
  return { streak, xpGained, levelBefore: user.level, levelAfter, alreadyClaimed: false, newAchievements };
}

const CHALLENGE_POOL = [
  { key: 'play_games', target: 3, description: 'Play 3 games today', xpReward: 100 },
  { key: 'win_games', target: 1, description: 'Win 1 game today', xpReward: 150 },
  { key: 'play_games_5', target: 5, description: 'Play 5 games today', xpReward: 200 },
  { key: 'xp_earn', target: 300, description: 'Earn 300 XP today', xpReward: 120 },
  { key: 'top3', target: 2, description: 'Finish in the top 3 twice today', xpReward: 180 },
];

export async function ensureDailyChallenges(): Promise<void> {  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const count = await prisma.dailyChallenge.count({ where: { day: today } });
  if (count >= 3) return;
  const selected = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  await prisma.dailyChallenge.createMany({
    data: selected.map((c) => ({ ...c, day: today })),
  });
}

export async function applyDailyChallenges(userId: string, placed: number, xpGained: number): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const challenges = await prisma.dailyChallenge.findMany({ where: { day: today } });
  if (challenges.length === 0) return;
  const winner = placed === 1;
  for (const challenge of challenges) {
    let progress = 0;
    if (challenge.key === 'play_games') progress = 1;
    else if (challenge.key === 'play_games_5') progress = 1;
    else if (challenge.key === 'win_games') progress = winner ? 1 : 0;
    else if (challenge.key === 'xp_earn') progress = xpGained;
    else if (challenge.key === 'top3') progress = placed <= 3 ? 1 : 0;
    if (progress === 0) continue;
    const existing = await prisma.userDailyProgress.findUnique({
      where: { userId_challengeId: { userId, challengeId: challenge.id } },
    });
    const newProgress = Math.min(challenge.target, (existing?.progress ?? 0) + progress);
    const completed = newProgress >= challenge.target && !(existing?.completed ?? false);
    await prisma.userDailyProgress.upsert({
      where: { userId_challengeId: { userId, challengeId: challenge.id } },
      create: {
        userId,
        challengeId: challenge.id,
        progress: newProgress,
        completed,
        completedAt: completed ? new Date() : null,
      },
      update: {
        progress: newProgress,
        completed: existing?.completed ? existing.completed : completed,
        completedAt: completed ? new Date() : null,
      },
    });
    if (completed) {
      await grantXp(userId, challenge.xpReward);
    }
  }
}

async function updatePlayerGameCount(userId: string, gameType: string): Promise<string[]> {
  const unlocked: string[] = [];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { _count: { select: { gameResults: true } } },
  });
  const totalGames = (user?._count.gameResults ?? 0) + 1;
  for (const [key, target] of [
    ['first_game', 1],
    ['games_5', 5],
    ['games_25', 25],
    ['games_100', 100],
  ] as const) {
    if (totalGames === target) {
      const res = await awardAchievement(userId, key);
      if (res.unlocked) unlocked.push(key);
    }
  }
  const gameKey = `game_${gameType}`;
  const res = await awardAchievement(userId, gameKey);
  if (res.unlocked) unlocked.push(gameKey);
  return unlocked;
}

async function updatePlayerWinCount(userId: string, placed: number): Promise<string[]> {
  if (placed !== 1) return [];
  // The current game's result is persisted after this loop, so count it manually.
  const wins = (await prisma.gameResult.count({ where: { userId, placed: 1 } })) + 1;
  const unlocked: string[] = [];
  for (const [key, target] of [
    ['win_1', 1],
    ['win_10', 10],
  ] as const) {
    if (wins === target) {
      const res = await awardAchievement(userId, key);
      if (res.unlocked) unlocked.push(key);
    }
  }
  return unlocked;
}

export async function awardGameRewards(
  room: LiveRoom,
  results: GameResultEntry[],
  awards: { key: string; emoji: string; title: string; userId?: string; detail?: string }[] = [],
  stats: { key: string; emoji: string; title: string; userId?: string; detail?: string }[] = [],
): Promise<void> {
  const def = getGame(room.gameType);
  const gameType = def?.type ?? 'unknown';
  const participantIds = results.map((r) => r.userId);
  await applyDailyStreak(participantIds);
  await ensureDailyChallenges();

  const rewarded: GameReward[] = [];
  for (const result of results) {
    const xp = 20 + placementXp(result.placed, results.length) + Math.min(Math.floor(result.score / 10), 40);
    const { levelBefore, levelAfter } = await grantXp(result.userId, xp);
    const season = await grantSeasonXp(result.userId, seasonXpForPlacement(result.placed, results.length));
    const newAchievements: string[] = [];
    const fromCounts = await updatePlayerGameCount(result.userId, gameType);
    const fromWins = await updatePlayerWinCount(result.userId, result.placed);
    newAchievements.push(...fromCounts, ...fromWins);
    if (levelBefore < 5 && levelAfter >= 5) {
      const res = await awardAchievement(result.userId, 'level_5');
      if (res.unlocked) newAchievements.push('level_5');
    }
    if (levelBefore < 10 && levelAfter >= 10) {
      const res = await awardAchievement(result.userId, 'level_10');
      if (res.unlocked) newAchievements.push('level_10');
    }
    const title = await unlockLevelTitle(result.userId, levelAfter);
    await applyDailyChallenges(result.userId, result.placed, xp);
    await markReferralPlayed(result.userId);
    rewarded.push({
      userId: result.userId,
      username: result.username,
      avatarColor: result.avatarColor,
      score: result.score,
      placed: result.placed,
      xpGained: xp,
      seasonXpGained: season.gained,
      levelBefore,
      levelAfter,
      newAchievements,
      newTitle: title ?? season.unlockedTitle ?? null,
    });
    if (newAchievements.length > 0 || levelAfter > levelBefore || season.unlockedTitle || title) {
      void createNotification(result.userId, 'achievement', {
        newAchievements,
        xpGained: xp,
        levelBefore,
        levelAfter,
        gameType,
        seasonXpGained: season.gained,
        seasonTier: season.newTier,
        newTitle: title ?? season.unlockedTitle ?? null,
      });
    }
  }

  const history = await prisma.gameHistory.create({
    data: {
      roomId: room.id,
      roomName: room.name,
      gameType,
      stats: stats.length > 0 ? (stats as unknown as object) : undefined,
      awards: awards.length > 0 ? (awards as unknown as object) : undefined,
      results: {
        create: results.map((r) => ({ userId: r.userId, score: r.score, placed: r.placed })),
      },
    },
  });

  void history;
  emitToRoom(room, 'game:finished', { results: rewarded, awards, roomId: room.id, historyId: history.id });
}
