import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { RoomState, TelephoneState, TelephoneStep } from '../types';
import { GameShell, Scoreboard } from './shared';
import DrawCanvas from './DrawCanvas';

interface Props {
  room: RoomState;
  game: TelephoneState;
  onLeave: () => void;
}

function StepPreview({ step }: { step: TelephoneStep }) {
  if (step.kind === 'prompt' || step.kind === 'caption') {
    return (
      <div className="glass-strong" style={{ padding: 14, borderRadius: 12, textAlign: 'center' }}>
        <div className="text-xs text-dim">{step.kind === 'prompt' ? 'Prompt' : 'Caption'}</div>
        <div style={{ fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{step.text}</div>
      </div>
    );
  }
  return (
    <div className="glass-strong" style={{ padding: 14, borderRadius: 12 }}>
      <div className="text-xs text-dim" style={{ marginBottom: 6 }}>
        Drawing
      </div>
      <DrawingThumb strokes={step.strokes ?? []} />
    </div>
  );
}

function DrawingThumb({ strokes }: { strokes: { points: { x: number; y: number }[]; color: string; size: number; tool: string }[] }) {
  return (
    <div style={{ width: '100%', height: 60, background: 'rgba(0,0,0,0.35)', borderRadius: 8, position: 'relative' }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
        {strokes.map((stroke, si) => (
          <polyline
            key={si}
            points={stroke.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
            fill="none"
            stroke={stroke.tool === 'eraser' ? 'rgba(0,0,0,0)' : stroke.color}
            strokeWidth={Math.max(0.5, stroke.size * 2)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}

export default function TelephoneGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction, subscribeGame } = useRealtime();
  const [text, setText] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);

  const myId = user?.id;
  const meSubmitted = game.me?.submitted ?? false;
  const canInteract = !meSubmitted && (game.phase === 'prompt' || game.phase === 'caption' || game.phase === 'draw');
  const myVote = myId ? game.votes?.[myId] ?? null : null;

  useEffect(() => {
    if (game.phase !== 'prompt' && game.phase !== 'draw' && game.phase !== 'caption') return;
    const msLeft = Math.max(0, (game.roundEndAt - Date.now()) / 1000);
    setTimeLeft(msLeft);
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase, game.roundEndAt, game.stepIndex]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || meSubmitted) return;
    sendGameAction({
      type: 'submitText',
      payload: { text: value },
    });
    setText('');
  };

  const handleDrawSubmit = () => {
    if (meSubmitted) return;
    sendGameAction({ type: 'submitDraw' });
  };

  const handleVote = (ownerId: string) => {
    if (myVote) return;
    sendGameAction({ type: 'vote', payload: { ownerId } });
  };

  const kindLabel = game.kind === 'prompt' ? 'Write a prompt' : game.kind === 'caption' ? 'Caption this drawing' : 'Draw this scene';

  return (
    <GameShell
      room={room}
      title="Telephone"
      badge={`Step ${Math.min(game.stepIndex + 1, game.totalSteps)} / ${game.totalSteps}`}
      onLeave={onLeave}
    >
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 220 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Get ready…</h2>
              <p className="text-dim text-sm">A story is about to get very mixed up</p>
            </div>
          )}

          {game.phase === 'reveal' && game.pages && (
            <div className="col">
              <h2 style={{ fontSize: 20, textAlign: 'center', marginBottom: 4 }}>
                The story, unravelled
              </h2>
              <p className="text-xs text-dim" style={{ textAlign: 'center', marginBottom: 12 }}>
                {myVote ? 'You voted — thanks!' : 'Vote for the funniest ending!'}
              </p>
              <div className="col" style={{ gap: 12 }}>
                {game.pages.map((page) => {
                  const isMine = page.ownerId === myId;
                  return (
                    <div key={page.ownerId} className="glass" style={{ padding: 14 }}>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                        <span className="text-sm" style={{ fontWeight: 700 }}>
                          {room.players.find((p) => p.userId === page.ownerId)?.username ?? 'Player'}
                          {isMine && <span className="badge" style={{ marginLeft: 8 }}>Yours</span>}
                        </span>
                        {!myVote && !isMine && (
                          <button className="btn btn-cyan text-sm" onClick={() => handleVote(page.ownerId)}>
                            Vote
                          </button>
                        )}
                        {myVote === page.ownerId && <span className="badge badge-success">Voted</span>}
                      </div>
                      <div className="col" style={{ gap: 8 }}>
                        {page.steps.map((step, i) => (
                          <StepPreview key={i} step={step} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 200 }}>
              <h2 style={{ fontSize: 24 }}>The chain is complete!</h2>
              <p className="text-dim">Results are on the scoreboard.</p>
            </div>
          )}

          {(game.phase === 'prompt' || game.phase === 'caption' || game.phase === 'draw') && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="badge badge-cyan">{kindLabel}</span>
                <span className="text-sm" style={{ fontWeight: 700 }}>
                  {Math.ceil(timeLeft)}s
                </span>
              </div>

              {game.page && game.page.history.length > 0 && (
                <div className="col" style={{ gap: 8, marginBottom: 14 }}>
                  <div className="text-xs text-dim">The story so far:</div>
                  {game.page.history.map((step, i) => (
                    <StepPreview key={i} step={step} />
                  ))}
                </div>
              )}

              {(game.phase === 'prompt' || game.phase === 'caption') && (
                <form onSubmit={handleTextSubmit} className="col" style={{ gap: 8 }}>
                  <input
                    className="input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={game.phase === 'prompt' ? 'A weird sentence to start…' : 'What is happening here?'}
                    maxLength={120}
                    disabled={meSubmitted}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-block" type="submit" disabled={meSubmitted || text.trim().length < 1}>
                    Submit
                  </button>
                </form>
              )}

              {game.phase === 'draw' && (
                <div className="col">
                  <DrawCanvas
                    room={room}
                    canDraw={canInteract}
                    onAction={sendGameAction}
                    subscribe={subscribeGame}
                    height={320}
                    placeholder={canInteract ? 'Draw what the last caption describes!' : 'Waiting for everyone…'}
                  />
                  <button className="btn btn-primary btn-block" onClick={handleDrawSubmit} disabled={meSubmitted} style={{ marginTop: 10 }}>
                    Submit drawing
                  </button>
                </div>
              )}

              {meSubmitted && (
                <p className="text-sm text-dim" style={{ textAlign: 'center', marginTop: 10 }}>
                  Submitted — waiting for everyone else…
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
