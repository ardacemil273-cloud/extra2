import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtime } from '../context/RealtimeContext';
import type { NotificationInfo } from '../types';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function notificationTitle(n: NotificationInfo): string {
  const payload = n.payload as { fromName?: string; roomName?: string; title?: string } | null;
  switch (n.kind) {
    case 'friend_request':
      return `${payload?.fromName ?? 'Someone'} sent you a friend request`;
    case 'friend_accepted':
      return `${payload?.fromName ?? 'Someone'} accepted your friend request`;
    case 'room_invite':
      return `${payload?.fromName ?? 'A friend'} invited you to "${payload?.roomName ?? 'a room'}"`;
    case 'achievement':
      return `Achievement unlocked: ${payload?.title ?? 'New badge'}`;
    case 'referral':
      return 'Your friend joined via your invite!';
    default:
      return 'You have a new notification';
  }
}

export default function NotificationBell() {
  const { notifications, unreadNotifications, refreshNotifications, markNotificationsRead } = useRealtime();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void refreshNotifications();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && unreadNotifications > 0) {
        void markNotificationsRead();
      }
      return next;
    });
  };

  const handleAction = (n: NotificationInfo) => {
    setOpen(false);
    const payload = n.payload as { roomId?: string; code?: string; userId?: string } | null;
    if (n.kind === 'room_invite' && payload?.code) {
      navigate('/lobby');
      sessionStorage.setItem('partyverse_pending_join', payload.code);
    } else if (n.kind === 'friend_request' && payload?.userId) {
      navigate('/profile');
    }
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        className="btn btn-ghost bell-btn"
        onClick={handleOpen}
        aria-label="Notifications"
        style={{ position: 'relative' }}
      >
        🔔
        {unreadNotifications > 0 && <span className="bell-dot">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
      </button>
      {open && (
        <div className="bell-dropdown glass-strong">
          <div className="row" style={{ justifyContent: 'space-between', padding: '10px 14px' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
            {notifications.length > 0 && (
              <button
                className="text-xs"
                style={{ color: 'var(--neon-cyan)', background: 'none', border: 'none', padding: 0 }}
                onClick={() => void markNotificationsRead()}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="bell-list">
            {notifications.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px 12px' }}>
                <p className="text-xs">No notifications yet.</p>
              </div>
            ) : (
              notifications.slice(0, 15).map((n) => (
                <button
                  key={n.id}
                  className="bell-item"
                  onClick={() => handleAction(n)}
                  style={{
                    background: n.read ? 'transparent' : 'rgba(168,85,247,0.08)',
                    border: 'none',
                    width: '100%',
                    textAlign: 'left',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                    {!n.read && <span className="bell-unread" />}
                    <span className="text-sm" style={{ flex: 1, lineHeight: 1.35 }}>
                      {notificationTitle(n)}
                    </span>
                    <span className="text-xs text-dim" style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
