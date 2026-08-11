import { useMemo, useState } from 'react';
import { useRealtime } from '../context/RealtimeContext';
import type { ReactionState, RoomState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: ReactionState;
  onLeave: () => void;
}

export default function ReactionGame({ room, game, onLeave }: Props) {
  const { sendGameAction } = useRealtime();
  const [clicked, setClicked] = useState(false);

  const handleClick = () => {
    if (clicked) return;
    setClicked(true);
    sendGameAction({ type: 'click' });
  };

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.wins ?? 0 };
      }),
    [room.players, game.players],
  );

  return (
    <GameShell
      room={room}
      title="Fastest Finger"
      badge={`Round ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`}
      onLeave={onLeave}
    >
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 300 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Get ready…</h2>
              <p className="text-dim text-sm">Wait for the signal!</p>
            </div>
          )}

          {game.phase === 'awaiting' && (
            <div className="col center" style={{ minHeight: 300 }}>
              <h2 style={{ fontSize: 24 }}>GO!</h2>
              <button
                className="big-action glow-pulse"
                onClick={handleClick}
                disabled={clicked}
              >
                {clicked ? 'Clicked!' : 'CLICK!'}
              </button>
              <p className="text-dim text-sm">Tap as fast as you can!</p>
            </div>
          )}

          {game.phase === 'result' && game.roundTimes && (
            <div className="col">
              <h2 style={{ fontSize: 22 }}>Round {game.round} results</h2>
              {game.roundWinner && (
                <span className="badge badge-success" style={{ alignSelf: 'center' }}>
                  {room.players.find((p) => p.userId === game.roundWinner)?.username} wins the round!
                </span>
              )}
              <div className="col">
                {room.players.map((p) => {
                  const ms = game.roundTimes![p.userId];
                  return (
                    <div key={p.userId} className="score-row">
                      <div className="row" style={{ gap: 10 }}>
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: p.avatarColor }}>
                          {p.username.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600 }}>{p.username}</span>
                        {game.roundWinner === p.userId && <span className="badge host-badge">Winner</span>}
                      </div>
                      <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        {typeof ms === 'number' ? `${ms} ms` : 'No click'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 180 }}>
              <h2 style={{ fontSize: 26 }}>Game over!</h2>
              <p className="text-dim">Fastest clicks win — check the scoreboard.</p>
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
