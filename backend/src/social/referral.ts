import { prisma } from '../prisma';
import { createNotification } from './notifications';

const REFERRAL_BONUS_XP = 100;

export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function resolveReferral(code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(normalized)) return null;
  const user = await prisma.user.findUnique({ where: { referralCode: normalized } });
  return user?.id ?? null;
}

export async function markReferralPlayed(userId: string): Promise<void> {
  // Award the referrer exactly once, the first time the invitee finishes a game.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { invitedBy: true, username: true, referralRewardedAt: true },
  });
  if (!user || !user.invitedBy || user.referralRewardedAt) return;
  const referrer = await prisma.user.findUnique({ where: { id: user.invitedBy } });
  if (!referrer) return;
  // Idempotency guard: only one caller may claim the reward.
  const claimed = await prisma.user.updateMany({
    where: { id: userId, referralRewardedAt: null },
    data: { referralRewardedAt: new Date() },
  });
  if (claimed.count === 0) return;
  await prisma.user.update({
    where: { id: referrer.id },
    data: { xp: { increment: REFERRAL_BONUS_XP }, invitesAccepted: { increment: 1 } },
  });
  await createNotification(referrer.id, 'referral', {
    fromName: user.username,
    xpGained: REFERRAL_BONUS_XP,
  }, userId);
  const { awardAchievement } = await import('./achievements');
  await awardAchievement(referrer.id, 'referral_1');
  if (referrer.invitesAccepted + 1 >= 5) {
    await awardAchievement(referrer.id, 'referral_5');
  }
}

export async function referralLink(userId: string): Promise<string | null> {
  let user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (!user) return null;
  if (!user.referralCode) {
    let code = generateReferralCode();
    let exists = await prisma.user.findUnique({ where: { referralCode: code } });
    while (exists) {
      code = generateReferralCode();
      exists = await prisma.user.findUnique({ where: { referralCode: code } });
    }
    await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
    user = { referralCode: code };
  }
  return user.referralCode;
}
