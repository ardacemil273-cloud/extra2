import { useEffect, useMemo, useState } from 'react';
import { useRealtime } from '../context/RealtimeContext';
import type { RevealState, RoomState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: RevealState;
  onLeave: () => void;
}

const MAX_ANSWER_LEN = 160;

export default function RevealGame({ room, game, onLeave }: Props) {
  const { sendGameAction } = useRealtime();
  const [answerText, setAnswerText] = useState('');
  const [timeLeft, setTimeLeft] = useState<number>(game.timerMs / 1000);

  const me = game.me ?? { answer: null, vote: null };
  const hasAnswered = Boolean(me.answer);
  const hasVoted = Boolean(me.vote);

  useEffect(() => {
    if (game.phase === 'question' || game.phase === 'vote') {
      setTimeLeft(Math.max(0, (game.roundEndAt - Date.now()) / 1000));
    }
  }, [game.phase, game.roundEndAt, game.round]);

  useEffect(() => {
    if (game.phase !== 'question' && game.phase !== 'vote') return;
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase, game.round]);

  useEffect(() => {
    setAnswerText('');
  }, [game.round, game.phase]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  const submitAnswer = () => {
    const text = answerText.trim();
    if (text.length < 1) return;
    sendGameAction({ type: 'submit', payload: { text } });
  };

  const voteFor = (targetId: string) => {
    if (hasVoted) return;
    sendGameAction({ type: 'vote', payload: { targetId } });
  };

  const showAnswers = game.phase === 'vote' || game.phase === 'reveal' || game.phase === 'finished';

  return (
    <GameShell room={room} title={`Reveal · ${game.deckLabel}`} badge={`Round ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`} onLeave={onLeave}>
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 240 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Warming up the room…</h2>
              <p className="text-dim text-sm">{game.deckLabel} deck locked in.</p>
            </div>
          )}

          {game.phase === 'question' && game.question && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="badge badge-cyan">{game.question.vibe}</span>
                <span className="text-sm" style={{ fontWeight: 700 }}>{Math.ceil(timeLeft)}s</span>
              </div>
              <h2 style={{ fontSize: 22, textAlign: 'center', margin: '8px 0 16px' }}>{game.question.text}</h2>

              {hasAnswered ? (
                <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
                  Answer locked in. Waiting for everyone else…
                </p>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  <textarea
                    className="input"
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        submitAnswer();
                      }
                    }}
                    placeholder="Type your answer. Be funny, be bold, be honest…"
                    maxLength={MAX_ANSWER_LEN}
                    rows={3}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-block" onClick={submitAnswer} disabled={answerText.trim().length < 1}>
                    Lock it in
                  </button>
                  <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
                    {answerText.length}/{MAX_ANSWER_LEN}
                  </p>
                </div>
              )}
            </div>
          )}

          {(game.phase === 'vote' || game.phase === 'reveal') && showAnswers && (
            <div className="col">
              <h2 style={{ fontSize: 20, textAlign: 'center', marginBottom: 4 }}>
                {game.phase === 'vote' ? 'Which answer wins the room?' : 'The room has voted'}
              </h2>
              <p className="text-xs text-dim" style={{ textAlign: 'center', marginBottom: 12 }}>
                {game.phase === 'vote' ? `${Math.ceil(timeLeft)}s left` : 'Tap Play Again to keep going.'}
              </p>
              <div className="col" style={{ gap: 8 }}>
                {game.order.map((id) => {
                  const p = game.players[id];
                  if (p.answer === null) return null;
                  const winner = game.phase === 'reveal' && (game.winnerIds ?? []).includes(id);
                  const isYouVote = me.vote === id;
                  return (
                    <button
                      key={id}
                      className="score-row cursor-pointer"
                      onClick={() => voteFor(id)}
                      disabled={game.phase === 'reveal' || hasVoted}
                      style={{
                        border: winner
                          ? '1px solid var(--success)'
                          : isYouVote
                            ? '1px solid var(--neon-purple)'
                            : '1px solid var(--glass-border)',
                        background: winner ? 'rgba(34,197,94,0.12)' : isYouVote ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: room.players.find((pl) => pl.userId === id)?.avatarColor ?? '#7c3aed' }}>
                        {room.players.find((pl) => pl.userId === id)?.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="grow" style={{ textAlign: 'left' }}>
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>{room.players.find((pl) => pl.userId === id)?.username ?? 'Player'}</span>
                          {winner && <span className="badge badge-success">Winner</span>}
                          {me.vote === id && <span className="badge badge-cyan">Your vote</span>}
                        </div>
                        <div className="text-sm" style={{ marginTop: 2 }}>{p.answer}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {game.phase === 'vote' && hasVoted && (
                <p className="text-xs text-dim" style={{ textAlign: 'center', marginTop: 10 }}>
                  Vote locked in.
                </p>
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
