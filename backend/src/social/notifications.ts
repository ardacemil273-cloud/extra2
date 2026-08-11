import { prisma } from '../prisma';
import { emitToUser } from '../socket/store';

export interface NotificationPublic {
  id: string;
  kind: string;
  actorId: string | null;
  payload: unknown;
  read: boolean;
  createdAt: string;
}

function toPublic(n: {
  id: string;
  kind: string;
  actorId: string | null;
  payload: unknown;
  read: boolean;
  createdAt: Date;
}): NotificationPublic {
  return {
    id: n.id,
    kind: n.kind,
    actorId: n.actorId,
    payload: n.payload,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function createNotification(
  userId: string,
  kind: string,
  payload: unknown,
  actorId?: string | null,
): Promise<NotificationPublic> {
  const notif = await prisma.notification.create({
    data: { userId, kind, actorId: actorId ?? null, payload: payload as object },
  });
  const pub = toPublic(notif);
  emitToUser(userId, 'notification:new', pub);
  return pub;
}

export async function listNotifications(userId: string, limit = 30): Promise<NotificationPublic[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toPublic);
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
  if (ids && ids.length > 0) {
    await prisma.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { read: true },
    });
    return;
  }
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}
