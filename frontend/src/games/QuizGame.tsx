import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { QuizState, RoomState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: QuizState;
  onLeave: () => void;
}

export default function QuizGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction } = useRealtime();
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(game.timePerQuestionMs / 1000);

  const me = room.players.find((p) => p.userId === user?.id);
  const myEntry = me ? game.players[me.userId] : undefined;

  useEffect(() => {
    if (game.phase === 'question') {
      setAnsweredIndex(null);
      setTimeLeft(game.timePerQuestionMs / 1000);
    }
  }, [game.phase, game.round, game.question, game.timePerQuestionMs]);

  useEffect(() => {
    if (game.phase !== 'question') return;
    const interval = window.setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 0.1));
    }, 100);
    return () => window.clearInterval(interval);
  }, [game.phase, game.round, game.question]);

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  const handleAnswer = (index: number) => {
    if (answeredIndex !== null || (myEntry && myEntry.answered)) return;
    setAnsweredIndex(index);
    sendGameAction({ type: 'answer', payload: { answerIndex: index } });
  };

  const percent = Math.min(100, (timeLeft / (game.timePerQuestionMs / 1000)) * 100);

  return (
    <GameShell room={room} title="Brain Battle" badge={`Question ${Math.min(game.round, game.totalRounds)} / ${game.totalRounds}`} onLeave={onLeave}>
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'countdown' && (
            <div className="col center" style={{ minHeight: 220 }}>
              <div className="spinner" style={{ width: 40, height: 40 }} />
              <h2 style={{ fontSize: 22 }}>Get ready…</h2>
              <p className="text-dim text-sm">Questions are coming</p>
            </div>
          )}

          {game.phase === 'question' && game.question && (
            <div className="col">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="badge badge-cyan">{game.question.category}</span>
                <span className="text-sm" style={{ fontWeight: 700 }}>
                  {Math.ceil(timeLeft)}s
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${percent}%`,
                    background: percent < 25 ? 'var(--danger)' : 'linear-gradient(90deg, var(--neon-purple), var(--neon-cyan))',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
              <h2 style={{ fontSize: 22, lineHeight: 1.35 }}>{game.question.text}</h2>
              <div className="col" style={{ gap: 10 }}>
                {game.question.options.map((opt, i) => {
                  const isMine = answeredIndex === i || myEntry?.answered;
                  return (
                    <button
                      key={i}
                      className="option-btn"
                      onClick={() => handleAnswer(i)}
                      disabled={answeredIndex !== null || Boolean(myEntry?.answered)}
                      style={isMine ? { borderColor: 'var(--neon-purple)', background: 'rgba(168,85,247,0.15)' } : undefined}
                    >
                      <span style={{ opacity: 0.6, marginRight: 10 }}>{String.fromCharCode(65 + i)}.</span>
                      {opt}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
                {myEntry?.answered ? 'Answer locked in — waiting for others…' : 'Tap an answer!'}
              </p>
            </div>
          )}

          {game.phase === 'reveal' && game.question && (
            <div className="col">
              <h2 style={{ fontSize: 20 }}>Answer revealed</h2>
              <div className="row" style={{ justifyContent: 'center' }}>
                <span className={`badge ${myEntry?.answered ? 'badge-success' : 'badge-danger'}`}>
                  {myEntry?.answered ? 'You answered' : 'You missed it'}
                </span>
              </div>
              <div className="col">
                {game.question.options.map((opt, i) => {
                  const isCorrect = i === game.correctIndex;
                  const isMyWrongPick = answeredIndex === i && i !== game.correctIndex;
                  return (
                    <div
                      key={i}
                      className={`option-btn ${isCorrect ? 'correct' : isMyWrongPick ? 'wrong' : ''}`}
                      style={{ textAlign: 'center', cursor: 'default' }}
                    >
                      {String.fromCharCode(65 + i)}. {opt}
                      {isCorrect && ' ✓'}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 180 }}>
              <h2 style={{ fontSize: 26 }}>Game over!</h2>
              <p className="text-dim">Results are on the scoreboard.</p>
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
