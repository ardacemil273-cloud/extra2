import { getAllRooms, deleteLiveRoom, clearTimers } from './store';
import { prisma } from '../prisma';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const FINISHED_TTL_MS = 20 * 60 * 1000;
const IDLE_LOBBY_TTL_MS = 60 * 60 * 1000;
const DEAD_GAME_TTL_MS = 10 * 60 * 1000;

function anyConnected(room: { players: Map<string, { connected: boolean }>; spectators: Map<string, { connected: boolean }> }): boolean {
  for (const p of room.players.values()) {
    if (p.connected) return true;
  }
  for (const p of room.spectators.values()) {
    if (p.connected) return true;
  }
  return false;
}

export async function sweepRooms(): Promise<void> {
  const now = Date.now();
  for (const room of getAllRooms()) {
    const connected = anyConnected(room);
    const idle = now - room.lastActivity;
    let stale = false;
    if (room.status === 'finished' && idle > FINISHED_TTL_MS) {
      stale = true;
    } else if (room.status === 'lobby' && idle > IDLE_LOBBY_TTL_MS) {
      stale = true;
    } else if (room.status === 'playing' && !connected && idle > DEAD_GAME_TTL_MS) {
      stale = true;
    }
    if (!stale) continue;
    clearTimers(room);
    deleteLiveRoom(room.id);
    await prisma.room
      .update({
        where: { id: room.id },
        data: { status: 'closed', closedAt: new Date() },
      })
      .catch(() => undefined);
  }
}

export function startSweeper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepRooms().catch((err) => {
      console.error('[partyverse] room sweep failed', err);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
