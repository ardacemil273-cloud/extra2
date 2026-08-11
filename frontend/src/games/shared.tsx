import type { ReactNode } from 'react';
import type { PlayerPublic, RoomState } from '../types';

interface GameShellProps {
  room: RoomState;
  title: string;
  badge: string;
  onLeave: () => void;
  children: ReactNode;
}

export function GameShell({ room, title, badge, onLeave, children }: GameShellProps) {
  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{title}</h1>
          <div className="text-dim text-sm">
            Room {room.room.code} · <span className="badge">{badge}</span>
          </div>
        </div>
        <button className="btn btn-danger text-sm" onClick={onLeave}>
          Leave
        </button>
      </div>
      {children}
    </main>
  );
}

export function Scoreboard({ room, players }: { room: RoomState; players: PlayerPublic[] }) {
  return (
    <div className="glass stat-card">
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Scoreboard</h2>
      <div className="col">
        {room.players.map((p) => (
          <div key={p.userId} className="score-row">
            <div className="row" style={{ gap: 10 }}>
              <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: p.avatarColor }}>
                {p.username.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontWeight: 600 }}>{p.username}</span>
            </div>
            <span style={{ fontWeight: 800 }}>{players.find((x) => x.userId === p.userId)?.score ?? p.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
