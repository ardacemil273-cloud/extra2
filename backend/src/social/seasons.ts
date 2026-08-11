import { prisma } from '../prisma';

export interface SeasonTier {
  xp: number;
  name: string;
  icon: string;
  title: string;
  color: string;
}

export interface SeasonDef {
  id: string;
  name: string;
  emoji: string;
  tiers: SeasonTier[];
}

export const SEASON: SeasonDef = {
  id: 'season-1-party-starters',
  name: 'Party Starters',
  emoji: '🎉',
  tiers: [
    { xp: 0, name: 'Rookie', icon: '🥉', title: 'Party Rookie', color: '#9ca3af' },
    { xp: 120, name: 'Regular', icon: '🥈', title: 'Party Regular', color: '#38bdf8' },
    { xp: 300, name: 'VIP', icon: '🥇', title: 'Party VIP', color: '#a78bfa' },
    { xp: 600, name: 'Star', icon: '⭐', title: 'Season Star', color: '#fbbf24' },
    { xp: 1000, name: 'Legend', icon: '👑', title: 'Season Legend', color: '#f472b6' },
  ],
};

export function tierForXp(xp: number): { tier: SeasonTier; index: number } {
  let result = SEASON.tiers[0];
  let index = 0;
  for (let i = 0; i < SEASON.tiers.length; i++) {
    if (xp >= SEASON.tiers[i].xp) {
      result = SEASON.tiers[i];
      index = i;
    }
  }
  return { tier: result, index };
}

export function tierProgress(xp: number): { tier: SeasonTier; index: number; next: SeasonTier | null; needed: number } {
  const { tier, index } = tierForXp(xp);
  const next = index + 1 < SEASON.tiers.length ? SEASON.tiers[index + 1] : null;
  const needed = next ? next.xp - xp : 0;
  return { tier, index, next, needed };
}

export function seasonXpForPlacement(placed: number, total: number): number {
  if (total <= 1) return 25;
  if (placed === 1) return 40;
  if (placed === 2) return 25;
  if (placed === 3) return 18;
  if (placed === 4) return 12;
  return 8;
}

async function unlockTitle(userId: string, title: string): Promise<boolean> {
  if (!title) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { unlockedTitles: true, title: true } });
  if (!user) return false;
  if (user.unlockedTitles.includes(title)) return false;
  const unlocked = [...user.unlockedTitles, title];
  await prisma.user.update({
    where: { id: userId },
    data: { unlockedTitles: unlocked, title: user.title === '' ? title : user.title },
  });
  return true;
}

export async function grantSeasonXp(userId: string, xp: number): Promise<{ gained: number; newTier: string | null; unlockedTitle: string | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { seasonXp: true, unlockedTitles: true } });
  if (!user) return { gained: 0, newTier: null, unlockedTitle: null };
  const before = tierForXp(user.seasonXp).index;
  const after = user.seasonXp + xp;
  await prisma.user.update({ where: { id: userId }, data: { seasonXp: after } });
  const afterTier = tierForXp(after).index;
  let unlockedTitle: string | null = null;
  if (afterTier > before) {
    const tier = SEASON.tiers[afterTier];
    if (!user.unlockedTitles.includes(tier.title)) {
      await unlockTitle(userId, tier.title);
      unlockedTitle = tier.title;
    }
    const { awardAchievement } = await import('./achievements');
    if (afterTier >= 2) await awardAchievement(userId, 'season_tier_2');
    if (afterTier >= 4) await awardAchievement(userId, 'season_tier_4');
  }
  return { gained: xp, newTier: afterTier > before ? SEASON.tiers[afterTier].name : null, unlockedTitle };
}

export async function getSeasonStatus(userId: string): Promise<{
  season: SeasonDef;
  xp: number;
  tier: SeasonTier;
  next: SeasonTier | null;
  needed: number;
  unlockedTitle: string | null;
}> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { seasonXp: true, unlockedTitles: true } });
  const xp = user?.seasonXp ?? 0;
  const { tier, next, needed } = tierProgress(xp);
  const title = user?.unlockedTitles.includes(tier.title) ? tier.title : null;
  return { season: SEASON, xp, tier, next, needed, unlockedTitle: title };
}

export async function claimSeasonTitle(userId: string): Promise<{ ok: boolean; title: string | null }> {
  const status = await getSeasonStatus(userId);
  const title = status.tier.title;
  await prisma.user.update({ where: { id: userId }, data: { title } });
  return { ok: true, title };
}
