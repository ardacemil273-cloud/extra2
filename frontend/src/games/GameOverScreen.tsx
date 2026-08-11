import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import type { AnyGameState, RoomState } from '../types';

interface Props {
  room: RoomState;
  game: AnyGameState | null;
  isHost: boolean;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
  onLeave: () => void;
}

function rankPlayers(room: RoomState, game: AnyGameState | null): { userId: string; username: string; avatarColor: string; score: number }[] {
  return room.players
    .map((p) => {
      let score = p.score;
      if (game) {
        const entry = game.players[p.userId] as { score?: number; wins?: number } | undefined;
        if (entry) {
          if (game.type === 'reaction') {
            score = entry.wins ?? 0;
          } else {
            score = entry.score ?? 0;
          }
        }
      }
      return { userId: p.userId, username: p.username, avatarColor: p.avatarColor, score };
    })
    .sort((a, b) => b.score - a.score);
}

export default function GameOverScreen({ room, game, isHost, onPlayAgain, onReturnToLobby, onLeave }: Props) {
  const { lastResults, lastAwards, lastHistoryId } = useRealtime();
  const { user } = useAuth();
  const { toast } = useToast();
  const ranking = useMemo(() => rankPlayers(room, game), [room, game]);
  const winner = ranking[0];

  const myResult = lastResults?.find((r) => r.userId === user?.id) ?? null;

  const shareUrl = lastHistoryId ? `${window.location.origin}/share/${lastHistoryId}` : null;

  const handleShare = async () => {
    if (!shareUrl) {
      toast('Share link is not ready yet.', 'error');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: 'PartyVerse result', url: shareUrl });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast('Result link copied!', 'success');
      }
    } catch {
      toast('Could not share the result.', 'error');
    }
  };

  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{room.room.name}</h1>
          <div className="text-dim text-sm">Game finished · Room {room.room.code}</div>
        </div>
        <button className="btn btn-danger text-sm" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="center" style={{ padding: '32px 0 16px' }}>
        <div className="glass-strong game-card animate-in" style={{ maxWidth: 520 }}>
          {winner && (
            <div className="col center" style={{ gap: 8 }}>
              <div className="avatar" style={{ width: 72, height: 72, fontSize: 30, background: winner.avatarColor }}>
                {winner.username.charAt(0).toUpperCase()}
              </div>
              <span className="badge badge-success">Winner</span>
              <h2 style={{ fontSize: 28 }}>{winner.username}</h2>
              <p className="text-dim text-sm">
                {game?.type === 'reaction'
                  ? `${winner.score} round wins`
                  : `${winner.score} points`}
              </p>
            </div>
          )}

          {myResult && (
            <div className="glass" style={{ margin: '16px 0', padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="text-sm" style={{ fontWeight: 700 }}>Your round</span>
                <span className="badge badge-success">+{myResult.xpGained} XP</span>
              </div>
              <div className="text-xs text-dim" style={{ marginTop: 4 }}>
                Level {myResult.levelBefore} → {myResult.levelAfter}
                {myResult.seasonXpGained > 0 && ` · +${myResult.seasonXpGained} season XP`}
              </div>
              {myResult.newAchievements.length > 0 && (
                <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {myResult.newAchievements.map((key) => (
                    <span key={key} className="badge badge-warning">🏆 New achievement</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {lastAwards && lastAwards.length > 0 && (
            <div className="col" style={{ marginBottom: 12 }}>
              <div className="text-xs text-dim" style={{ fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
                🎭 HALL OF FAME
              </div>
              {lastAwards.map((a) => (
                <div key={a.key} className="score-row" style={{ textAlign: 'left' }}>
                  <span style={{ fontSize: 20 }}>{a.emoji}</span>
                  <div className="grow">
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{a.title}</div>
                    {a.detail && <div className="text-xs text-dim">{a.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="col mt-2">
            {ranking.map((p, i) => (
              <div key={p.userId} className="score-row">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ width: 22, fontWeight: 800, opacity: 0.7 }}>{i + 1}.</span>
                  <div className="avatar" style={{ width: 28, height: 28, fontSize: 13, background: p.avatarColor }}>
                    {p.username.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontWeight: 600 }}>{p.username}</span>
                </div>
                <span style={{ fontWeight: 800 }}>{p.score}</span>
              </div>
            ))}
          </div>

          <div className="divider" />

          {shareUrl && (
            <button className="btn btn-cyan btn-block mb-1" onClick={handleShare}>
              📤 Share this result
            </button>
          )}

          {isHost ? (
            <div className="col">
              <button className="btn btn-primary btn-block btn-lg" onClick={onPlayAgain}>
                Play again
              </button>
              <button className="btn btn-ghost" onClick={onReturnToLobby}>
                Back to lobby
              </button>
            </div>
          ) : (
            <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
              Waiting for the host to start a new round…
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
