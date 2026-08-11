import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { fetchFriends, fetchGames, fetchInvite } from '../api';
import { ApiError } from '../api/client';
import ChatPanel from '../components/ChatPanel';
import DiscordAd from '../components/DiscordAd';
import type { FriendUser, GameMeta, PlayerPublic } from '../types';

const PENDING_JOIN_KEY = 'partyverse_pending_join';

export default function Lobby() {
  const { user } = useAuth();
  const {
    room,
    game,
    joinRoom,
    leaveRoom,
    setReady,
    selectGame,
    startGame,
    connected,
    spectate,
    updateSettings,
    setVibe,
    inviteFriend,
  } = useRealtime();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameMeta[]>([]);
  const [password, setPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const joinedRef = useRef(false);

  useEffect(() => {
    void fetchGames()
      .then((data) => setGames(data.games))
      .catch((err) => {
        if (err instanceof ApiError) toast(err.message, 'error');
      });
    void fetchFriends()
      .then((data) => setFriends(data.friends))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (joinedRef.current) return;
    if (!room && connected) {
      const pending = sessionStorage.getItem(PENDING_JOIN_KEY);
      if (pending) {
        joinedRef.current = true;
        sessionStorage.removeItem(PENDING_JOIN_KEY);
        joinRoom(pending);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, room]);

  useEffect(() => {
    if (room && room.room.status === 'playing' && game) {
      navigate('/game');
    }
  }, [room, game, navigate]);

  useEffect(() => {
    if (!room) return;
    setMaxPlayers(room.room.maxPlayers?.toString() ?? '');
  }, [room?.room.id, room?.room.maxPlayers]);

  if (!room) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="col center">
          <div className="spinner" />
          <p className="text-dim">Joining room…</p>
        </div>
      </main>
    );
  }

  const me = room.players.find((p: PlayerPublic) => p.userId === user?.id) ?? null;
  const isHost = room.room.ownerId === user?.id;
  const allReady = room.players.every((p) => p.isReady);
  const selectedGame = games.find((g) => g.type === room.room.gameType);

  const handleLeave = () => {
    leaveRoom();
    navigate('/dashboard');
  };

  const handleSavePassword = () => {
    updateSettings({ password: password.trim() || undefined });
    toast(password.trim() ? 'Password set for this room.' : 'Password removed.', 'success');
  };

  const handleSaveMaxPlayers = () => {
    const value = parseInt(maxPlayers, 10);
    if (maxPlayers !== '' && (Number.isNaN(value) || value < 2 || value > 32)) {
      toast('Max players must be between 2 and 32.', 'error');
      return;
    }
    updateSettings({ maxPlayers: maxPlayers === '' ? null : value });
    toast(maxPlayers === '' ? 'Unlimited players.' : `Max players set to ${value}.`, 'success');
  };

  const handleCopyInvite = async () => {
    try {
      const { invite } = await fetchInvite(room.room.id);
      setInviteUrl(invite.url);
      await navigator.clipboard.writeText(invite.url);
      toast('Invite link copied!', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create invite link.', 'error');
    }
  };

  const toggleSpectate = () => {
    if (me) {
      spectate(true);
    } else {
      spectate(false);
    }
  };

  const friendsInRoom = new Set([...room.players, ...room.spectators].map((p) => p.userId));
  const invitableFriends = friends.filter((f) => !friendsInRoom.has(f.id));

  const handleInviteFriend = (friendId: string, name: string) => {
    inviteFriend(friendId);
    toast(`Invite sent to ${name}!`, 'success');
  };

  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <DiscordAd />
      <div className="game-with-chat">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lobby-layout">
            <section className="glass stat-card animate-in">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 800 }}>{room.room.name}</h1>
                  <p className="text-dim text-sm">
                    {room.room.hasPassword ? 'Password protected' : 'Public room'}
                    {room.room.maxPlayers !== null && ` · max ${room.room.maxPlayers}`}
                  </p>
                </div>
                <button className="btn btn-danger text-sm" onClick={handleLeave}>
                  Leave
                </button>
              </div>

              <div className="glass-strong" style={{ padding: 20, textAlign: 'center', marginTop: 8 }}>
                <div className="text-xs text-dim" style={{ letterSpacing: 2 }}>
                  ROOM CODE
                </div>
                <div className="room-code-display">{room.room.code}</div>
              </div>

              <div className="row" style={{ marginTop: 16, gap: 8 }}>
                <span className="badge badge-cyan">
                  {room.players.length} player{room.players.length === 1 ? '' : 's'}
                </span>
                {room.spectators.length > 0 && (
                  <span className="badge">
                    {room.spectators.length} spectating
                  </span>
                )}
                <span className={`badge ${room.room.status === 'playing' ? 'badge-warning' : 'badge-success'}`}>
                  {room.room.status === 'playing' ? 'In game' : 'Lobby'}
                </span>
              </div>

              {isHost && (
                <div className="col" style={{ marginTop: 14, gap: 8 }}>
                  <div className="text-xs text-dim" style={{ fontWeight: 700, letterSpacing: 1 }}>
                    ROOM VIBE
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { value: 'mixed', label: '🎲 Mixed' },
                      { value: 'friends', label: '🤝 Friends' },
                      { value: 'spice', label: '🌶️ Spice' },
                      { value: 'chaos', label: '🌀 Chaos' },
                    ].map((v) => (
                      <button
                        key={v.value}
                        className="badge cursor-pointer"
                        onClick={() => setVibe(v.value)}
                        style={{
                          borderColor: room.room.vibe === v.value ? 'var(--neon-cyan)' : undefined,
                          background: room.room.vibe === v.value ? 'rgba(34,211,238,0.15)' : undefined,
                          fontSize: 13,
                          padding: '8px 14px',
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <h2 style={{ fontSize: 16, margin: '18px 0 8px' }}>Players</h2>
              <div className="col">
                {room.players.map((p) => (
                  <PlayerRow
                    key={p.userId}
                    player={p}
                    isSelf={p.userId === user?.id}
                    onViewProfile={(username) => navigate(`/user/${encodeURIComponent(username)}`)}
                  />
                ))}
              </div>

              {room.spectators.length > 0 && (
                <>
                  <h2 style={{ fontSize: 14, margin: '14px 0 8px', opacity: 0.7 }}>Spectators</h2>
                  <div className="col">
                    {room.spectators.map((p) => (
                      <PlayerRow
                        key={p.userId}
                        player={p}
                        isSelf={p.userId === user?.id}
                        isSpectator
                        onViewProfile={(username) => navigate(`/user/${encodeURIComponent(username)}`)}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="divider" style={{ margin: '16px 0' }} />

              <div className="col" style={{ gap: 10 }}>
                {me ? (
                  <button className="btn btn-ghost" onClick={toggleSpectate}>
                    Become a spectator
                  </button>
                ) : (
                  <button className="btn btn-cyan" onClick={toggleSpectate}>
                    Join the game
                  </button>
                )}

                {isHost && (
                  <>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={room.room.hasPassword ? 'New password' : 'Set a password (optional)'}
                        maxLength={64}
                        style={{ flex: 1 }}
                      />
                      <button className="btn btn-ghost" onClick={handleSavePassword}>
                        {room.room.hasPassword ? 'Change' : 'Protect'}
                      </button>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <input
                        className="input"
                        value={maxPlayers}
                        onChange={(e) => setMaxPlayers(e.target.value)}
                        placeholder="Max players (blank = unlimited)"
                        inputMode="numeric"
                        maxLength={2}
                        style={{ flex: 1 }}
                      />
                      <button className="btn btn-ghost" onClick={handleSaveMaxPlayers}>
                        Save
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="col">
              <div className="glass stat-card animate-in" style={{ animationDelay: '0.06s' }}>
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>Pick a game</h2>
                <div className="col">
                  {games.map((g) => {
                    const selected = room.room.gameType === g.type;
                    return (
                      <button
                        key={g.type}
                        className="score-row cursor-pointer"
                        style={{
                          border: selected
                            ? '1px solid var(--neon-purple)'
                            : '1px solid var(--glass-border)',
                          background: selected ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.04)',
                        }}
                        onClick={() => selectGame(selected ? null : g.type)}
                        disabled={!isHost || room.room.status === 'playing'}
                      >
                        <div className="grow" style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 700 }}>
                            {g.icon} {g.label}
                          </div>
                          <div className="text-dim text-xs">{g.description}</div>
                        </div>
                        <span className="badge">{g.minPlayers}+ players</span>
                      </button>
                    );
                  })}
                </div>
                {!isHost && (
                  <p className="text-xs text-dim mt-2">Only the host can change the game.</p>
                )}
              </div>

              <div className="glass stat-card animate-in" style={{ animationDelay: '0.1s' }}>
                <h2 style={{ fontSize: 16, marginBottom: 4 }}>
                  Invite friends
                </h2>
                {invitableFriends.length === 0 ? (
                  <p className="text-xs text-dim">
                    {friends.length === 0
                      ? 'Add friends on your profile to invite them.'
                      : 'All your friends are already here!'}
                  </p>
                ) : (
                  <div className="col" style={{ gap: 6 }}>
                    {invitableFriends.slice(0, 6).map((f) => (
                      <div key={f.id} className="score-row">
                        {f.avatarUrl ? (
                          <img src={f.avatarUrl} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div className="avatar" style={{ width: 26, height: 26, fontSize: 11, background: f.avatarColor }}>
                            {f.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="grow" style={{ fontWeight: 600, fontSize: 14 }}>{f.username}</div>
                        <button className="btn btn-cyan text-sm" onClick={() => handleInviteFriend(f.id, f.username)}>
                          Invite
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {isHost && (
                  <button className="btn btn-ghost text-sm btn-block mt-1" onClick={handleCopyInvite}>
                    Copy invite link
                  </button>
                )}
                {inviteUrl && (
                  <p className="text-xs text-dim" style={{ wordBreak: 'break-all', textAlign: 'center' }}>
                    {inviteUrl}
                  </p>
                )}
              </div>

              <div className="glass stat-card animate-in" style={{ animationDelay: '0.12s' }}>
                <h2 style={{ fontSize: 16, marginBottom: 4 }}>
                  {selectedGame ? selectedGame.label : 'Ready to play'}
                </h2>
                {isHost ? (
                  <>
                    <button
                      className="btn btn-primary btn-block btn-lg"
                      onClick={() => startGame()}
                      disabled={!selectedGame || !allReady || room.room.status === 'playing'}
                    >
                      Start game
                    </button>
                    {!allReady && (
                      <p className="text-xs text-dim mt-1" style={{ textAlign: 'center' }}>
                        Waiting for all players to be ready…
                      </p>
                    )}
                    {!selectedGame && (
                      <p className="text-xs text-dim mt-1" style={{ textAlign: 'center' }}>
                        Select a game to start.
                      </p>
                    )}
                  </>
                ) : (
                  <button
                    className={`btn btn-block btn-lg ${me?.isReady ? 'btn-ghost' : 'btn-cyan'}`}
                    onClick={() => setReady(!(me?.isReady ?? false))}
                    disabled={room.room.status === 'playing'}
                  >
                    {me?.isReady ? 'Not ready' : "I'm ready"}
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>

        <div style={{ width: 300, flexShrink: 0 }}>
          <ChatPanel />
        </div>
      </div>
    </main>
  );
}

function PlayerRow({
  player,
  isSelf,
  isSpectator,
  onViewProfile,
}: {
  player: PlayerPublic;
  isSelf: boolean;
  isSpectator?: boolean;
  onViewProfile?: (username: string) => void;
}) {
  return (
    <div className="player-row" style={isSelf ? { borderColor: 'rgba(168,85,247,0.5)' } : undefined}>
      {player.avatarUrl ? (
        <img src={player.avatarUrl} alt="" className="avatar" style={{ width: 40, height: 40, objectFit: 'cover' }} />
      ) : (
        <div className="avatar" style={{ background: player.avatarColor }}>
          {player.username.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="grow">
        <div className="row" style={{ gap: 8 }}>
          <button
            className="username-link"
            onClick={() => onViewProfile?.(player.username)}
            style={{ fontSize: 15 }}
          >
            {player.username}
          </button>
          {player.isHost && <span className="badge host-badge">Host</span>}
          {isSpectator && <span className="badge">Spectating</span>}
          {isSelf && <span className="badge">You</span>}
        </div>
        <div className="text-dim text-xs">
          <span
            className={`status-dot ${player.connected ? 'online' : 'offline'}`}
            style={{ display: 'inline-block', marginRight: 6 }}
          />
          {player.connected ? 'Online' : 'Reconnecting…'} · {player.score} pts
        </div>
      </div>
      {!isSpectator &&
        (player.isReady ? (
          <span className="badge badge-success">Ready</span>
        ) : (
          <span className="badge badge-warning">Not ready</span>
        ))}
    </div>
  );
}
