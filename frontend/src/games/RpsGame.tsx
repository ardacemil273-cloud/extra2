import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import type { RpsChoice, RoomState, RpsState } from '../types';
import { GameShell, Scoreboard } from './shared';

interface Props {
  room: RoomState;
  game: RpsState;
  onLeave: () => void;
}

const CHOICES: { value: RpsChoice; emoji: string; label: string }[] = [
  { value: 'rock', emoji: '🪨', label: 'Rock' },
  { value: 'paper', emoji: '📄', label: 'Paper' },
  { value: 'scissors', emoji: '✂️', label: 'Scissors' },
];

function choiceEmoji(choice: RpsChoice | null): string {
  return CHOICES.find((c) => c.value === choice)?.emoji ?? '❔';
}

export default function RpsGame({ room, game, onLeave }: Props) {
  const { user } = useAuth();
  const { sendGameAction } = useRealtime();
  const [myChoice, setMyChoice] = useState<RpsChoice | null>(null);

  const me = room.players.find((p) => p.userId === user?.id);

  const handleChoose = (choice: RpsChoice) => {
    if (myChoice) return;
    setMyChoice(choice);
    sendGameAction({ type: 'choose', payload: { choice } });
  };

  const scoreboardPlayers = useMemo(
    () =>
      room.players.map((p) => {
        const entry = game.players[p.userId];
        return { ...p, score: entry?.score ?? 0 };
      }),
    [room.players, game.players],
  );

  return (
    <GameShell
      room={room}
      title="RPS Battle Royale"
      badge={`Round ${game.round} · first to ${game.targetScore}`}
      onLeave={onLeave}
    >
      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        <div className="glass-strong game-card animate-in">
          {game.phase === 'round' && (
            <div className="col center" style={{ minHeight: 260 }}>
              <h2 style={{ fontSize: 22 }}>Pick your move</h2>
              <p className="text-dim text-sm">Rock beats scissors, paper beats rock, scissors beats paper</p>
              <div className="row" style={{ justifyContent: 'center', gap: 14, marginTop: 8 }}>
                {CHOICES.map((c) => (
                  <button
                    key={c.value}
                    className={`rps-choice ${myChoice === c.value ? 'selected' : ''}`}
                    onClick={() => handleChoose(c.value)}
                    disabled={Boolean(myChoice)}
                    aria-label={c.label}
                    title={c.label}
                  >
                    {c.emoji}
                  </button>
                ))}
              </div>
              {myChoice && (
                <p className="text-xs text-dim" style={{ marginTop: 8 }}>
                  {me?.username} chose {choiceEmoji(myChoice)} — waiting for everyone…
                </p>
              )}
            </div>
          )}

          {game.phase === 'reveal' && game.outcomes && (
            <div className="col">
              <h2 style={{ fontSize: 22 }}>Round {game.round} revealed</h2>
              <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {room.players.map((p) => {
                  const entry = game.players[p.userId];
                  return (
                    <div key={p.userId} className="col center" style={{ gap: 4, padding: 12 }}>
                      <div className="avatar" style={{ background: p.avatarColor }}>
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{p.username}</div>
                      <div style={{ fontSize: 26 }}>{choiceEmoji(entry.currentChoice)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="col">
                {room.players.map((p) => {
                  const outcome = game.outcomes![p.userId];
                  return (
                    <div key={p.userId} className="score-row">
                      <span style={{ fontWeight: 600 }}>{p.username}</span>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="badge badge-success">Beats {outcome.wins.length || '—'}</span>
                        <span className="badge">Ties {outcome.ties.length || '—'}</span>
                        <span className="badge badge-danger">Loses {outcome.loses.length || '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {game.phase === 'finished' && (
            <div className="col center" style={{ minHeight: 180 }}>
              <h2 style={{ fontSize: 26 }}>Game over!</h2>
              <p className="text-dim">The battle royale has a winner — check the scoreboard.</p>
            </div>
          )}
        </div>

        <Scoreboard room={room} players={scoreboardPlayers} />
      </div>
    </GameShell>
  );
}
