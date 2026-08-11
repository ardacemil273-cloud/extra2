process.env.DATABASE_URL =
  'postgresql://partyverse:partyverse_dev_pw@localhost:5432/partyverse_test';
process.env.JWT_SECRET = 'test-secret-for-vitest';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "players" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "rooms" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "friends" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "game_history" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "game_results" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "achievements" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "user_achievements" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "daily_challenges" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "user_daily_progress" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "chat_messages" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "reactions" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "notifications" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "reports" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "site_config" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
  await prisma.$disconnect();
}

await resetDatabase();
