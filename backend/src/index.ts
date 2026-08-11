import { createGameServer } from './server';
import { config } from './config';
import { startSweeper } from './socket/cleanup';
import { ensureAchievements, ensureDailyChallenges } from './social/achievements';

const { server } = createGameServer();

void ensureAchievements().catch((err) => {
  console.error('[partyverse] failed to seed achievements', err);
});
void ensureDailyChallenges().catch((err) => {
  console.error('[partyverse] failed to seed daily challenges', err);
});

const sweeper = startSweeper();

server.listen(config.port, () => {
  console.log(`[partyverse] backend listening on http://localhost:${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`[partyverse] received ${signal}, shutting down`);
  clearInterval(sweeper);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
