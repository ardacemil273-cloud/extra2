import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { ChameleonState, RoomState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: ChameleonState;
  onLeave: () => void;
}

const MAX_CLUE_LEN = 40;

export default function ChameleonGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction } = useRealtime();
  const [clueText, setClueText] = useState('');
  const [timeLeft, setTimeLeft] = useState<number>(game.timerMs / 1000);

  const myId = user?.id;
  const me = game.me ?? { isChameleon: false, word: null, caught: null, vote: null };
  const isMyTurn = game.phase === 'clue' && game.currentClueId === myId;
  const hasGivenClue = myId ? (game.players[myId]?.clue ?? null) !== null : false;

  useEffect(() => {
    if (game.phase === 'clue' || game.phase === 'vote' || game.phase === 'reveal') {
      setTimeLeft(Math.max(0, (game.roundEndAt - Date.now()) / 1000));
    }
  }, [game.phase, game.roundEndAt, game.round]);

  useEffect(() => {
    if (game.phase !== 'clue' && game.phase !== 'vote') return;
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase, game.round]);

  useEffect(() => {
    setClueText('');
  }, [game.round, game.phase]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  const submitClue = () => {
    const text = clueText.trim();
    if (text.length < 1) return;
    sendGameAction({ type: 'clue', payload: { text } });
  };

  const voteFor = (targetId: string) => {
    if (me.vote) return;
    sendGameAction({ type: 'vote', payload: { targetId } });
  };

  const voted = Boolean(me.vote);

  return (
    <GameShell room={room} title="Chameleon" badge={`Round ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`} onLeave={onLeave}>
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 240 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Picking a secret word…</h2>
              <p className="text-dim text-sm">One of you won't know what it is.</p>
            </div>
          )}

          {game.phase === 'clue' && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="badge badge-cyan">{game.category}</span>
                <span className="text-sm" style={{ fontWeight: 700 }}>{Math.ceil(timeLeft)}s</span>
              </div>

              {me.isChameleon ? (
                <div className="col center" style={{ textAlign: 'center', marginBottom: 12 }}>
                  <span className="badge badge-danger" style={{ fontSize: 13, marginBottom: 6 }}>You are the Chameleon!</span>
                  <p className="text-sm text-dim">
                    You have <strong>no idea</strong> what the word is. Listen to others and blend in.
                  </p>
                </div>
              ) : (
                <div className="col center" style={{ textAlign: 'center', marginBottom: 12 }}>
                  <span className="badge badge-success" style={{ fontSize: 13, marginBottom: 6 }}>The word is:</span>
                  <div className="room-code-display" style={{ fontSize: 26 }}>{me.word}</div>
                </div>
              )}

              <div className="col" style={{ gap: 8, marginBottom: 12 }}>
                {game.order.map((id, i) => {
                  const p = game.players[id];
                  const isYou = id === myId;
                  const isCurrent = id === game.currentClueId;
                  return (
                    <div
                      key={id}
                      className="score-row"
                      style={{
                        border: isCurrent ? '1px solid var(--neon-purple)' : '1px solid var(--glass-border)',
                        background: isCurrent ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <span className="badge">{i + 1}</span>
                      <div className="grow" style={{ textAlign: 'left', fontWeight: 600 }}>
                        {room.players.find((pl) => pl.userId === id)?.username ?? 'Player'}
                        {isYou && <span className="badge" style={{ marginLeft: 8 }}>You</span>}
                        {isCurrent && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Clue time</span>}
                      </div>
                      <span className="text-sm text-dim">{p.clue ?? '…'}</span>
                    </div>
                  );
                })}
              </div>

              {isMyTurn ? (
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    value={clueText}
                    onChange={(e) => setClueText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitClue()}
                    placeholder="Drop a clue that doesn't give it away…"
                    maxLength={MAX_CLUE_LEN}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={submitClue} disabled={clueText.trim().length < 1}>
                    Send
                  </button>
                </div>
              ) : hasGivenClue ? (
                <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
                  Clue locked in. Waiting for the next player…
                </p>
              ) : (
                <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
                  Waiting for your turn to drop a clue…
                </p>
              )}
            </div>
          )}

          {game.phase === 'vote' && (
            <div className="col">
              <h2 style={{ fontSize: 20, textAlign: 'center', marginBottom: 4 }}>Who's the Chameleon?</h2>
              <p className="text-xs text-dim" style={{ textAlign: 'center', marginBottom: 12 }}>
                Category: {game.category} · {Math.ceil(timeLeft)}s left
              </p>
              <div className="col" style={{ gap: 8 }}>
                {game.order.map((id) => {
                  if (id === myId) return null;
                  const isYouVote = me.vote === id;
                  return (
                    <button
                      key={id}
                      className="score-row cursor-pointer"
                      onClick={() => voteFor(id)}
                      disabled={voted}
                      style={{
                        border: isYouVote ? '1px solid var(--neon-purple)' : '1px solid var(--glass-border)',
                        background: isYouVote ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: room.players.find((p) => p.userId === id)?.avatarColor ?? '#7c3aed' }}>
                        {room.players.find((p) => p.userId === id)?.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="grow" style={{ textAlign: 'left', fontWeight: 600 }}>
                        {room.players.find((p) => p.userId === id)?.username ?? 'Player'}
                      </div>
                      {me.vote === id && <span className="badge badge-success">Voted</span>}
                    </button>
                  );
                })}
              </div>
              {voted && (
                <p className="text-xs text-dim" style={{ textAlign: 'center', marginTop: 10 }}>
                  Vote locked in.
                </p>
              )}
            </div>
          )}

          {game.phase === 'reveal' && (
            <div className="col center" style={{ textAlign: 'center', minHeight: 240 }}>
              <span className="badge" style={{ fontSize: 40, marginBottom: 8 }}>
                {me.isChameleon ? '🦎' : '🔍'}
              </span>
              <h2 style={{ fontSize: 22, marginBottom: 6 }}>
                {game.caught ? 'The Chameleon was caught!' : 'The Chameleon got away!'}
              </h2>
              {me.isChameleon ? (
                <p className="text-sm text-dim">
                  You were the Chameleon. The word was <strong>{me.word}</strong>.
                </p>
              ) : (
                <p className="text-sm text-dim">
                  {game.caught ? 'Nice detective work!' : 'Better luck next round — the fake slipped through.'}
                </p>
              )}
              {game.votesByTarget && (
                <div className="col" style={{ gap: 6, marginTop: 12 }}>
                  {Object.entries(game.votesByTarget).map(([target, voters]) => (
                    <div key={target} className="score-row" style={{ width: '100%' }}>
                      <span className="text-sm" style={{ fontWeight: 600 }}>
                        {room.players.find((p) => p.userId === target)?.username ?? 'Player'}
                      </span>
                      <span className="text-xs text-dim">
                        {voters.length} vote{voters.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 200 }}>
              <h2 style={{ fontSize: 24 }}>Game over!</h2>
              <p className="text-dim">See the scoreboard for the final tally.</p>
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
