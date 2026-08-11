import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { DrawState, RoomState } from '../types';
import { GameShell, Scoreboard } from './shared';
import DrawCanvas from './DrawCanvas';

interface Props {
  room: RoomState;
  game: DrawState;
  onLeave: () => void;
}

export default function DrawGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction, subscribeGame } = useRealtime();
  const [guess, setGuess] = useState('');
  const [guessMsg, setGuessMsg] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);

  const me = room.players.find((p) => p.userId === user?.id);
  const isDrawer = game.drawerId === user?.id;
  const myEntry = me ? game.players[me.userId] : undefined;
  const canDraw = isDrawer && game.phase === 'drawing';

  useEffect(() => {
    if (game.phase === 'drawing') {
      setTimeLeft(Math.max(0, (game.roundEndAt - Date.now()) / 1000));
    }
  }, [game.phase, game.roundEndAt]);

  useEffect(() => {
    if (game.phase !== 'drawing') return;
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  const handleGuessSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = guess.trim();
    if (!text || myEntry?.guessed) return;
    sendGameAction({ type: 'guess', payload: { text } });
    setGuess('');
    setGuessMsg('Guess sent!');
    window.setTimeout(() => setGuessMsg(''), 2500);
  };

  const wordRevealed = game.word && (game.phase === 'reveal' || game.phase === 'finished' || isDrawer);

  return (
    <GameShell
      room={room}
      title="Draw & Guess"
      badge={`Round ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`}
      onLeave={onLeave}
    >
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 260 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Get ready…</h2>
              <p className="text-dim text-sm">The first artist is chosen randomly</p>
            </div>
          )}

          {game.phase !== 'countdown' && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                {isDrawer ? (
                  <span className="badge badge-warning">You are drawing!</span>
                ) : (
                  <span className="badge badge-cyan">
                    {room.players.find((p) => p.userId === game.drawerId)?.username ?? 'Someone'} is drawing
                  </span>
                )}
                {game.phase === 'drawing' && (
                  <span className="text-sm" style={{ fontWeight: 700 }}>
                    {Math.ceil(timeLeft)}s
                  </span>
                )}
              </div>

              <div style={{ minHeight: 44, textAlign: 'center', marginBottom: 8 }}>
                {wordRevealed ? (
                  <span className="badge badge-success" style={{ fontSize: 16, letterSpacing: '0.08em' }}>
                    {game.word}
                  </span>
                ) : isDrawer ? (
                  <span className="badge badge-warning" style={{ fontSize: 16, letterSpacing: '0.08em' }}>
                    {game.word ?? ''}
                  </span>
                ) : (
                  <span className="text-lg" style={{ letterSpacing: '0.15em', fontWeight: 700 }}>
                    {game.wordPattern ?? ''}
                  </span>
                )}
                {game.phase === 'drawing' && !isDrawer && game.hint && (
                  <div className="text-xs text-dim" style={{ marginTop: 4 }}>
                    Hint: {game.hint}
                  </div>
                )}
              </div>

              <DrawCanvas
                room={room}
                canDraw={canDraw}
                onAction={sendGameAction}
                subscribe={subscribeGame}
                height={360}
                placeholder={canDraw ? 'Draw here!' : 'Waiting for strokes…'}
              />

              {!isDrawer && game.phase === 'drawing' && (
                <form onSubmit={handleGuessSubmit} className="row" style={{ gap: 8, marginTop: 12 }}>
                  <input
                    className="input"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="Type your guess…"
                    maxLength={40}
                    disabled={Boolean(myEntry?.guessed)}
                    style={{ textTransform: 'lowercase' }}
                  />
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={Boolean(myEntry?.guessed) || guess.trim().length < 2}
                  >
                    Guess
                  </button>
                </form>
              )}

              {myEntry?.guessed && (
                <p className="text-sm" style={{ textAlign: 'center', color: 'var(--success)', marginTop: 8 }}>
                  You got it!
                </p>
              )}

              {guessMsg && (
                <p className="text-xs text-dim" style={{ textAlign: 'center', marginTop: 8 }}>
                  {guessMsg}
                </p>
              )}

              {game.phase === 'reveal' && (
                <p className="text-sm" style={{ textAlign: 'center', marginTop: 8 }}>
                  The word was <strong>{game.word}</strong>
                </p>
              )}

              {game.phase === 'finished' && (
                <p className="text-sm" style={{ textAlign: 'center', marginTop: 8 }}>
                  Game over — results are on the scoreboard.
                </p>
              )}
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
