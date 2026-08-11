import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { RoomState, SabotajState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: SabotajState;
  onLeave: () => void;
}

const STATION_COLORS = ['#22d3ee', '#a855f7', '#3b82f6', '#22c55e', '#f59e0b'];

export default function SabotajGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction } = useRealtime();
  const [timeLeft, setTimeLeft] = useState(0);

  const myId = user?.id;
  const me = game.me ?? { role: null, choice: null, voteTarget: null, ejected: false };
  const isSaboteur = me.role === 'saboteur';

  useEffect(() => {
    if (game.phase === 'action' || game.phase === 'discussion' || game.phase === 'vote') {
      setTimeLeft(Math.max(0, (game.roundEndAt - Date.now()) / 1000));
    }
  }, [game.phase, game.roundEndAt, game.round]);

  useEffect(() => {
    if (game.phase !== 'action' && game.phase !== 'discussion' && game.phase !== 'vote') return;
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase, game.round]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return {
          ...p,
          score: entry && entry.role === game.winner ? (game.winner === 'crew' ? 200 : 300) : 50,
        };
      }),
    [room.players, game.players, game.winner],
  );

  const pickStation = (index: number) => {
    if (me.ejected || me.choice !== null || game.phase !== 'action') return;
    sendGameAction({ type: 'pick', payload: { station: index } });
  };

  const voteFor = (targetId: string) => {
    if (me.ejected || me.voteTarget || game.phase !== 'vote') return;
    sendGameAction({ type: 'vote', payload: { targetId } });
  };

  const activePlayers = room.players.filter((p) => !game.players[p.userId]?.ejected);

  const statusBadge =
    game.winner === 'crew' ? (
      <span className="badge badge-success">Crew wins!</span>
    ) : game.winner === 'saboteur' ? (
      <span className="badge badge-danger">Saboteur wins!</span>
    ) : (
      <span className="badge badge-cyan">
        Round {Math.min(game.round, game.maxRounds)} / {game.maxRounds}
      </span>
    );

  return (
    <GameShell room={room} title="Sabotaj" badge={statusBadge as unknown as string} onLeave={onLeave}>
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 240 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Assigning roles…</h2>
              <p className="text-dim text-sm">Don't trust anyone</p>
            </div>
          )}

          {(game.phase === 'action' || game.phase === 'result' || game.phase === 'voteResult') && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  {me.role && (
                    <span className={`badge ${isSaboteur ? 'badge-danger' : 'badge-success'}`}>
                      {isSaboteur ? 'Saboteur' : 'Crew'}
                    </span>
                  )}
                  {me.ejected && <span className="badge badge-warning">Ejected</span>}
                  {me.choice !== null && <span className="badge">Chose station {me.choice + 1}</span>}
                </div>
                {(game.phase === 'action' || game.phase === 'result') && (
                  <span className="text-sm" style={{ fontWeight: 700 }}>
                    {Math.ceil(timeLeft)}s
                  </span>
                )}
              </div>

              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <span className="badge badge-success">Fixed {game.fixedCount}/{game.stationTarget}</span>
                <span className="badge badge-danger">Sabotaged {game.sabotageCount}/{game.sabotageTarget}</span>
              </div>

              <div className="col" style={{ gap: 10 }}>
                {game.stations.map((station, i) => {
                  const mine = me.choice === i;
                  return (
                    <button
                      key={i}
                      className="score-row cursor-pointer"
                      onClick={() => pickStation(i)}
                      disabled={game.phase !== 'action' || me.ejected || me.choice !== null}
                      style={{
                        border: mine ? '1px solid var(--neon-purple)' : '1px solid var(--glass-border)',
                        background: mine ? 'rgba(168,85,247,0.15)' : station.sabotaged ? 'rgba(244,63,94,0.12)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: STATION_COLORS[i % STATION_COLORS.length],
                          flexShrink: 0,
                        }}
                      />
                      <div className="grow" style={{ textAlign: 'left' }}>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 700 }}>Station {i + 1}</span>
                          <span className="text-xs text-dim">
                            {station.fixed ? 'Fixed' : station.sabotaged ? 'Sabotaged!' : `${station.progress}/2`}
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 }}>
                          <div
                            style={{
                              height: '100%',
                              width: station.fixed ? '100%' : station.sabotaged ? '0%' : `${(station.progress / 2) * 100}%`,
                              background: station.fixed ? 'var(--success)' : station.sabotaged ? 'var(--danger)' : 'var(--neon-cyan)',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {game.phase === 'result' && (
                <p className="text-sm" style={{ textAlign: 'center', marginTop: 10 }}>
                  {game.sabotageCount > 0 && 'Something was sabotaged! '}
                  {game.fixedCount > 0 && 'The crew fixed more stations. '}
                  Now… who did it?
                </p>
              )}

              {game.phase === 'voteResult' && (
                <p className="text-sm" style={{ textAlign: 'center', marginTop: 10 }}>
                  {game.ejectedId ? (
                    <>
                      <strong>{room.players.find((p) => p.userId === game.ejectedId)?.username ?? 'Someone'}</strong> was ejected
                      {game.ejectedRole ? ` — they were ${game.ejectedRole === 'saboteur' ? 'the Saboteur!' : 'part of the Crew.'}` : '.'}
                    </>
                  ) : (
                    'No one was ejected — it was a tie.'
                  )}
                </p>
              )}
            </div>
          )}

          {game.phase === 'discussion' && (
            <div className="col center" style={{ minHeight: 240 }}>
              <h2 style={{ fontSize: 22 }}>Discussion time</h2>
              <p className="text-dim text-sm" style={{ textAlign: 'center' }}>
                Argue your case in the chat! Voting starts in {Math.ceil(timeLeft)}s.
              </p>
              <span className="text-sm" style={{ fontWeight: 800, fontSize: 28 }}>
                {Math.ceil(timeLeft)}s
              </span>
            </div>
          )}

          {game.phase === 'vote' && (
            <div className="col">
              <h2 style={{ fontSize: 20, textAlign: 'center', marginBottom: 4 }}>Who's the saboteur?</h2>
              <p className="text-xs text-dim" style={{ textAlign: 'center', marginBottom: 12 }}>
                Vote to eject someone · {Math.ceil(timeLeft)}s left
              </p>
              <div className="col" style={{ gap: 8 }}>
                {activePlayers.map((p) => {
                  const votedFor = me.voteTarget === p.userId;
                  return (
                    <button
                      key={p.userId}
                      className="score-row cursor-pointer"
                      onClick={() => voteFor(p.userId)}
                      disabled={me.ejected || Boolean(me.voteTarget)}
                      style={{
                        border: votedFor ? '1px solid var(--neon-purple)' : '1px solid var(--glass-border)',
                        background: votedFor ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: p.avatarColor }}>
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="grow" style={{ textAlign: 'left', fontWeight: 600 }}>
                        {p.username}
                        {p.userId === myId && <span className="badge" style={{ marginLeft: 8 }}>You</span>}
                      </div>
                      {me.voteTarget === p.userId && <span className="badge badge-success">Voted</span>}
                    </button>
                  );
                })}
              </div>
              {me.ejected && (
                <p className="text-xs text-dim" style={{ textAlign: 'center', marginTop: 10 }}>
                  You were ejected earlier and are watching.
                </p>
              )}
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 200 }}>
              <h2 style={{ fontSize: 24 }}>
                {game.winner === 'crew' ? 'The crew saved the ship!' : 'The saboteur slipped away!'}
              </h2>
              <p className="text-dim">Results are on the scoreboard.</p>
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
