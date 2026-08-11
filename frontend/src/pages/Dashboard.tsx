import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../api/client';
import { createRoom, fetchActiveRooms, fetchGames, fetchMe, fetchRecommendations } from '../api';
import DiscordAd from '../components/DiscordAd';
import type { ActiveRoom, GameMeta, RecentRoom, Recommendation } from '../types';

const PENDING_JOIN_KEY = 'partyverse_pending_join';

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { quickPlay } = useRealtime();
  const navigate = useNavigate();

  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('');
  const [gameType, setGameType] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [quickPlaying, setQuickPlaying] = useState(false);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  useEffect(() => {
    void fetchMe()
      .then((data) => setRecentRooms(data.recentRooms))
      .catch((err) => {
        if (err instanceof ApiError) toast(err.message, 'error');
      });
    void fetchActiveRooms()
      .then((data) => setActiveRooms(data.rooms))
      .catch(() => undefined);
    void fetchGames()
      .then((data) => setGames(data.games))
      .catch(() => undefined);
    void fetchRecommendations()
      .then((data) => setRecommendations(data.recommendations))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const maxP = parseInt(maxPlayers, 10);
      const options: { name?: string; password?: string; maxPlayers?: number | null; gameType?: string | null } = {
        name: roomName.trim() || undefined,
        maxPlayers: maxPlayers === '' ? null : maxP,
        gameType: gameType === '' ? null : gameType,
      };
      if (password.trim()) options.password = password.trim();
      const { room } = await createRoom(options);
      sessionStorage.setItem(PENDING_JOIN_KEY, room.room.code);
      navigate('/lobby');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create room.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      toast('Room codes are 6 characters.', 'error');
      return;
    }
    sessionStorage.setItem(PENDING_JOIN_KEY, code);
    navigate('/lobby');
  };

  const handleQuickPlay = () => {
    setQuickPlaying(true);
    quickPlay();
    navigate('/lobby');
  };

  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <h1 className="page-title">Hey, {user?.username}!</h1>
      <p className="text-dim mb-2">Grab your friends and jump into a game.</p>

      {(user?.level ?? 1) <= 1 && (
        <div className="glass-strong onboarding-hero animate-in" style={{ marginBottom: 18 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div className="grow" style={{ minWidth: 220 }}>
              <h2 style={{ fontSize: 22, fontWeight: 800 }}>Let's get you into a party 🎉</h2>
              <p className="text-sm text-dim" style={{ marginTop: 6 }}>
                In 30 seconds you'll be laughing with strangers. Hit Quick play — we'll drop you straight into a room.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn-cyan" onClick={handleQuickPlay} disabled={quickPlaying}>
                  {quickPlaying ? <span className="spinner" /> : '⚡ Quick play'}
                </button>
                <button className="btn btn-ghost" onClick={() => navigate('/profile')}>
                  Or customize your profile
                </button>
              </div>
            </div>
            <div className="onboarding-steps" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['Join a room', 'Play with friends', 'Earn XP & titles'].map((s, i) => (
                <div key={s} className="score-row" style={{ padding: '8px 12px', gap: 8 }}>
                  <span className="badge">{i + 1}</span>
                  <span className="text-sm" style={{ fontWeight: 600 }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <DiscordAd />

      <div className="dashboard-grid">
        <section className="col">
          <div className="glass stat-card animate-in">
            <span className="badge badge-cyan" style={{ alignSelf: 'flex-start' }}>
              Create a room
            </span>
            <h2 style={{ fontSize: 20 }}>Start a new party</h2>
            <p className="text-dim text-sm">
              You'll be the host. Choose a game, protect it with a password, and share the code.
            </p>
            <form onSubmit={handleCreate} className="col">
              <input
                className="input"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Room name (optional)"
                maxLength={40}
              />
              <select
                className="input"
                value={gameType}
                onChange={(e) => setGameType(e.target.value)}
              >
                <option value="">No game yet (pick in lobby)</option>
                {games.map((g) => (
                  <option key={g.type} value={g.type}>
                    {g.icon} {g.label}
                  </option>
                ))}
              </select>
              <div className="row" style={{ gap: 8 }}>
                <input
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (optional)"
                  maxLength={64}
                  style={{ flex: 1 }}
                />
                <input
                  className="input"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(e.target.value)}
                  placeholder="Max players"
                  inputMode="numeric"
                  maxLength={2}
                  style={{ width: 130 }}
                />
              </div>
              <button className="btn btn-primary btn-block" type="submit" disabled={creating}>
                {creating ? <span className="spinner" /> : 'Create room'}
              </button>
            </form>

            <button
              className="btn btn-cyan btn-block"
              onClick={handleQuickPlay}
              disabled={quickPlaying}
              style={{ marginTop: 10 }}
            >
              {quickPlaying ? <span className="spinner" /> : '⚡ Quick play — jump straight in'}
            </button>
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.08s' }}>
            <span className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>
              Join a room
            </span>
            <h2 style={{ fontSize: 20 }}>Got an invite code?</h2>
            <form onSubmit={handleJoin} className="col">
              <input
                className="input input-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
              />
              <button className="btn btn-blue btn-block" type="submit">
                Join room
              </button>
            </form>
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.16s' }}>
            <span className="badge badge-success" style={{ alignSelf: 'flex-start' }}>
              Your profile
            </span>
            <div className="row">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="avatar" style={{ width: 48, height: 48, objectFit: 'cover' }} />
              ) : (
                <div className="avatar" style={{ background: user?.avatarColor ?? '#7c3aed' }}>
                  {user?.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{user?.username}</div>
                <div className="text-dim text-sm">Level {user?.level ?? 1} · {user?.xp ?? 0} XP</div>
              </div>
              <button className="btn btn-ghost" onClick={() => navigate('/profile')}>
                View
              </button>
            </div>
          </div>

          {recommendations.length > 0 && (
            <div className="glass stat-card animate-in" style={{ animationDelay: '0.2s' }}>
              <span className="badge badge-cyan" style={{ alignSelf: 'flex-start' }}>
                For you
              </span>
              <h2 style={{ fontSize: 18 }}>Try something new</h2>
              <div className="col">
                {recommendations.map((r) => {
                  const game = games.find((g) => g.type === r.type);
                  return (
                    <div key={r.type} className="score-row">
                      <div className="grow">
                        <div style={{ fontWeight: 700 }}>
                          {game?.icon ?? '🎮'} {r.label}
                        </div>
                        <div className="text-dim text-xs">{r.reason}</div>
                      </div>
                      <button
                        className="btn btn-cyan text-sm"
                        onClick={() => {
                          setGameType(r.type);
                        }}
                      >
                        Play
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-dim mt-1">
                Pick one above and hit "Create room" to jump in.
              </p>
            </div>
          )}
        </section>

        <section className="col">
          <div className="glass stat-card animate-in" style={{ animationDelay: '0.1s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Recent rooms</h2>
            {recentRooms.length === 0 ? (
              <div className="empty-state">
                <p>No rooms yet.</p>
                <p className="text-xs mt-1">Create a room to get started.</p>
              </div>
            ) : (
              <div className="col">
                {recentRooms.map((r) => (
                  <div key={r.id} className="score-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {r.name}
                        <span
                          className="badge mt-1"
                          style={{ marginLeft: 8, letterSpacing: '0.1em' }}
                        >
                          {r.code}
                        </span>
                      </div>
                      <div className="text-dim text-xs">
                        {r.gameType ?? 'No game selected'} · {new Date(r.playedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost text-sm"
                      onClick={() => {
                        sessionStorage.setItem(PENDING_JOIN_KEY, r.code);
                        navigate('/lobby');
                      }}
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.18s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>Active rooms</h2>
            {activeRooms.length === 0 ? (
              <div className="empty-state">
                <p>No active rooms right now.</p>
              </div>
            ) : (
              <div className="col">
                {activeRooms.slice(0, 8).map((r) => (
                  <div key={r.id} className="score-row">
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {r.name}
                        {r.isPrivate && (
                          <span className="badge" style={{ marginLeft: 8 }}>
                            🔒
                          </span>
                        )}
                      </div>
                      <div className="text-dim text-xs">
                        {r.gameType ?? 'Lobby'} · {r.playerCount} player{r.playerCount === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className="badge" style={{ letterSpacing: '0.1em' }}>
                      {r.code}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
