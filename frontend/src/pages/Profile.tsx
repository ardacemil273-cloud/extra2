import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../api/client';
import {
  acceptFriend,
  addFriend,
  claimDaily,
  claimSeasonTitle,
  fetchAchievements,
  fetchChallenges,
  fetchFriends,
  fetchHistory,
  fetchLeaderboard,
  fetchProfile,
  fetchReferral,
  fetchSeason,
  removeFriend,
  updateDiscordAd,
  uploadAdImage,
  uploadAvatar,
} from '../api';
import type {
  AchievementInfo,
  DailyChallengeInfo,
  FriendUser,
  HistoryEntry,
  LeaderboardEntry,
  ReferralInfo,
  SeasonStatus,
} from '../types';

interface DiscordAdForm {
  enabled: boolean;
  title: string;
  subtitle: string;
  url: string;
  imageUrl: string | null;
}

export default function Profile() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<{ xp: number; level: number; dailyStreak: number; progress: { xpIntoLevel: number; needed: number } } | null>(null);
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [requests, setRequests] = useState<{ id: string; username: string; avatarColor: string; avatarUrl: string | null }[]>([]);
  const [friendInput, setFriendInput] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [achievements, setAchievements] = useState<AchievementInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [challenges, setChallenges] = useState<DailyChallengeInfo[]>([]);
  const [streak, setStreak] = useState(0);
  const [season, setSeason] = useState<SeasonStatus | null>(null);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [ad, setAd] = useState<DiscordAdForm>({
    enabled: false,
    title: 'Join our Discord',
    subtitle: 'Hang out, find parties and get game news.',
    url: 'https://discord.gg/partyverse',
    imageUrl: null,
  });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const adFileRef = useRef<HTMLInputElement | null>(null);

  const loadSocial = () => {
    void fetchProfile()
      .then((data) =>
        setProfile({ ...data.user, progress: data.progress }),
      )
      .catch(() => undefined);
    void fetchFriends()
      .then((data) => {
        setFriends(data.friends);
        setRequests(data.requests);
      })
      .catch(() => undefined);
    void fetchLeaderboard()
      .then((data) => setLeaderboard(data.leaderboard))
      .catch(() => undefined);
    void fetchAchievements()
      .then((data) => setAchievements(data.achievements))
      .catch(() => undefined);
    void fetchHistory()
      .then((data) => setHistory(data.history))
      .catch(() => undefined);
    void fetchChallenges()
      .then((data) => {
        setStreak(data.streak);
        setChallenges(data.challenges);
      })
      .catch(() => undefined);
    void fetchSeason()
      .then((data) => setSeason(data))
      .catch(() => undefined);
    void fetchReferral()
      .then((data) => setReferral(data))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadSocial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return null;

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      uploadAvatar(dataUrl)
        .then((res) => {
          toast('Avatar updated!', 'success');
          window.dispatchEvent(new CustomEvent('partyverse:profile-updated'));
          void res;
        })
        .catch((err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'));
    };
    reader.readAsDataURL(file);
  };

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    const username = friendInput.trim();
    if (!username) return;
    addFriend(username)
      .then(() => {
        toast('Friend request sent!', 'success');
        setFriendInput('');
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not add friend.', 'error'));
  };

  const handleAccept = (id: string) => {
    acceptFriend(id)
      .then(() => {
        toast('Friend added!', 'success');
        loadSocial();
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not accept.', 'error'));
  };

  const handleRemove = (id: string) => {
    removeFriend(id)
      .then(() => {
        toast('Friend removed.', 'success');
        loadSocial();
      })
      .catch(() => undefined);
  };

  const handleClaimDaily = () => {
    claimDaily()
      .then((res) => {
        if (res.alreadyClaimed) {
          toast('You already claimed today\'s reward.', 'info');
          return;
        }
        setDailyClaimed(true);
        setStreak(res.streak);
        toast(`Daily reward claimed: +${res.xpGained} XP (streak ${res.streak} 🔥)`, 'success');
        window.dispatchEvent(new CustomEvent('partyverse:profile-updated'));
      })
      .catch(() => toast('Could not claim daily reward.', 'error'));
  };

  const handleAdImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      uploadAdImage(dataUrl)
        .then((res) => {
          setAd(res.ad);
          toast('Ad image updated!', 'success');
        })
        .catch((err) => toast(err instanceof ApiError ? err.message : 'Upload failed.', 'error'));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAd = () => {
    updateDiscordAd({ enabled: ad.enabled, title: ad.title, subtitle: ad.subtitle, url: ad.url })
      .then((res) => {
        setAd(res.ad);
        toast('Discord ad updated!', 'success');
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not update ad.', 'error'));
  };

  const progressPct = profile && profile.progress.needed > 0
    ? Math.min(100, Math.round((profile.progress.xpIntoLevel / profile.progress.needed) * 100))
    : 0;

  const gameTypeLabel = (t: string | null) => {
    const map: Record<string, string> = {
      quiz: 'Brain Battle',
      reaction: 'Fastest Finger',
      rps: 'RPS Battle Royale',
      draw: 'Draw & Guess',
      telephone: 'Telephone',
      sabotaj: 'Sabotaj',
    };
    return t ? (map[t] ?? t) : 'Lobby';
  };

  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <h1 className="page-title">Profile</h1>
      <div className="dashboard-grid">
        <section className="col">
          <div className="glass stat-card animate-in">
            <div className="row">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="avatar" style={{ width: 64, height: 64, objectFit: 'cover' }} />
              ) : (
                <div className="avatar" style={{ width: 64, height: 64, fontSize: 28, background: user.avatarColor }}>
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="grow">
                <h2 style={{ fontSize: 22 }}>{user.username}</h2>
                <p className="text-dim text-sm">{user.email}</p>
              </div>
            </div>

            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarFile} />
            <button className="btn btn-ghost text-sm" onClick={() => fileRef.current?.click()}>
              Upload avatar
            </button>

            <div className="divider" />

            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="text-dim">Level {profile?.level ?? user.level ?? 1}</span>
                <span className="text-sm" style={{ fontWeight: 700 }}>
                  {profile ? `${profile.progress.xpIntoLevel} / ${profile.progress.needed} XP` : `${user.xp ?? 0} XP`}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 5, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    background: 'linear-gradient(90deg, var(--neon-purple), var(--neon-cyan))',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div className="score-row">
                <span className="text-dim">Daily streak</span>
                <span style={{ fontWeight: 700 }}>{streak} 🔥</span>
              </div>
              <div className="score-row">
                <span className="text-dim">Games played</span>
                <span style={{ fontWeight: 600 }}>{history.length}</span>
              </div>
            </div>

            <button
              className="btn btn-danger mt-2"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              Logout
            </button>
          </div>

          {season && (
            <div className="glass stat-card animate-in" style={{ animationDelay: '0.04s' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <h2 style={{ fontSize: 18 }}>
                  Season · {season.season.emoji} {season.season.name}
                </h2>
                <span className="badge badge-cyan">{season.tier.icon} {season.tier.name}</span>
              </div>
              <p className="text-xs text-dim">
                {season.xp} season XP{season.next ? ` · ${season.needed} XP to ${season.next.icon} ${season.next.name}` : ' · Max tier!'}
              </p>
              <div style={{ height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 6 }}>
                <div
                  style={{
                    height: '100%',
                    width: season.next
                      ? `${Math.min(100, Math.round(((season.xp - season.tier.xp) / (season.next.xp - season.tier.xp)) * 100))}%`
                      : '100%',
                    background: 'linear-gradient(90deg, var(--neon-purple), var(--neon-cyan))',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
              <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {season.tiers.map((t) => (
                  <span
                    key={t.xp}
                    className="badge"
                    style={{
                      borderColor: season.xp >= t.xp ? t.color : undefined,
                      color: season.xp >= t.xp ? t.color : undefined,
                      opacity: season.xp >= t.xp ? 1 : 0.5,
                    }}
                  >
                    {t.icon} {t.name}
                  </span>
                ))}
              </div>
              {season.unlockedTitle && (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button
                    className="btn btn-cyan"
                    onClick={() =>
                      claimSeasonTitle()
                        .then(() => toast('Title claimed!', 'success'))
                        .catch(() => undefined)
                    }
                  >
                    Equip title: {season.unlockedTitle}
                  </button>
                </div>
              )}
            </div>
          )}

          {referral && (
            <div className="glass stat-card animate-in" style={{ animationDelay: '0.06s' }}>
              <h2 style={{ fontSize: 18, marginBottom: 4 }}>Invite friends</h2>
              <p className="text-xs text-dim">
                Get {referral.invitesAccepted} friend{referral.invitesAccepted === 1 ? '' : 's'} to join through your link and earn bonus XP.
              </p>
              {referral.url && (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <input
                    className="input"
                    readOnly
                    value={referral.url}
                    style={{ flex: 1, fontSize: 12 }}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="btn btn-cyan"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(referral.url ?? '')
                        .then(() => toast('Referral link copied!', 'success'))
                        .catch(() => undefined)
                    }
                  >
                    Copy
                  </button>
                </div>
              )}
              <div className="badge badge-warning" style={{ marginTop: 8 }}>
                {referral.code ?? '—'} · {referral.invitesAccepted} accepted
              </div>
            </div>
          )}

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.08s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Friends</h2>
            <form onSubmit={handleAddFriend} className="row" style={{ gap: 8, marginBottom: 12 }}>
              <input
                className="input"
                value={friendInput}
                onChange={(e) => setFriendInput(e.target.value)}
                placeholder="Add friend by username"
                maxLength={20}
                style={{ flex: 1 }}
              />
              <button className="btn btn-cyan" type="submit">
                Add
              </button>
            </form>

            {requests.length > 0 && (
              <>
                <div className="text-xs text-dim" style={{ margin: '8px 0' }}>Requests</div>
                <div className="col" style={{ gap: 6 }}>
                  {requests.map((r) => (
                    <div key={r.id} className="score-row">
                      <span style={{ fontWeight: 600 }}>{r.username}</span>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn btn-success text-sm" onClick={() => handleAccept(r.id)}>
                          Accept
                        </button>
                        <button className="btn btn-ghost text-sm" onClick={() => handleRemove(r.id)}>
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {friends.length === 0 && requests.length === 0 ? (
              <div className="empty-state">
                <p>No friends yet.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {friends.map((f) => (
                  <div key={f.id} className="score-row">
                    {f.avatarUrl ? (
                      <img src={f.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 12, background: f.avatarColor }}>
                        {f.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="grow">
                      <button
                        className="username-link"
                        onClick={() => navigate(`/user/${encodeURIComponent(f.username)}`)}
                      >
                        {f.username}
                      </button>
                      {f.playing && (
                        <button
                          className="text-xs"
                          style={{ color: 'var(--neon-cyan)', background: 'none', border: 'none', padding: 0 }}
                          onClick={() => {
                            navigate('/lobby');
                            sessionStorage.setItem('partyverse_pending_join', f.playing!.code);
                          }}
                        >
                          Playing {gameTypeLabel(f.playing.gameType)} in {f.playing.code} → join
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-dim">Lv {f.level}</span>
                    <button className="btn btn-ghost text-sm" onClick={() => handleRemove(f.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.16s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Daily challenges</h2>
            {challenges.length === 0 ? (
              <div className="empty-state">
                <p>No challenges today.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {challenges.map((c) => (
                  <div key={c.id} className="score-row">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{c.description}</div>
                      <div className="text-xs text-dim">
                        {c.progress} / {c.target} · +{c.xpReward} XP
                      </div>
                      <div style={{ height: 5, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, (c.progress / c.target) * 100)}%`,
                            background: c.completed ? 'var(--success)' : 'var(--neon-purple)',
                          }}
                        />
                      </div>
                    </div>
                    {c.completed && <span className="badge badge-success">Done</span>}
                  </div>
                ))}
                <button className="btn btn-primary btn-block" onClick={handleClaimDaily} disabled={dailyClaimed}>
                  {dailyClaimed ? 'Daily reward claimed ✓' : `Claim daily reward (streak ${streak} 🔥)`}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="col">
          <div className="glass stat-card animate-in" style={{ animationDelay: '0.06s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Leaderboard</h2>
            <div className="col">
              {leaderboard.slice(0, 10).map((e, i) => {
                const isMe = e.id === user.id;
                return (
                  <div key={e.id} className="score-row" style={isMe ? { border: '1px solid rgba(168,85,247,0.5)' } : undefined}>
                    <span style={{ width: 22, fontWeight: 800, opacity: 0.7 }}>{i + 1}</span>
                    {e.avatarUrl ? (
                      <img src={e.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 12, background: e.avatarColor }}>
                        {e.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="grow">
                      <button
                        className="username-link"
                        onClick={() => navigate(`/user/${encodeURIComponent(e.username)}`)}
                        style={{ fontWeight: 600 }}
                      >
                        {e.username}
                      </button>
                      {isMe && <span className="badge" style={{ marginLeft: 8 }}>You</span>}
                    </div>
                    <span className="text-xs text-dim">Lv {e.level}</span>
                    <span style={{ fontWeight: 700 }}>{e.xp} XP</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.1s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Achievements</h2>
            {achievements.length === 0 ? (
              <div className="empty-state">
                <p>No achievements yet.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {achievements.map((a) => (
                  <div key={a.key} className="score-row" style={a.earned ? { border: '1px solid rgba(34,197,94,0.4)' } : undefined}>
                    <span style={{ fontSize: 20, opacity: a.earned ? 1 : 0.35 }}>{a.icon}</span>
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div className="text-xs text-dim">{a.description}</div>
                    </div>
                    <span className="text-xs text-dim">+{a.xpReward} XP</span>
                    {a.earned ? (
                      <span className="badge badge-success">Earned</span>
                    ) : (
                      <span className="badge">Locked</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.14s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Match history</h2>
            {history.length === 0 ? (
              <div className="empty-state">
                <p>No games played yet.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {history.slice(0, 12).map((h) => (
                  <div key={h.id} className="score-row">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{h.roomName}</div>
                      <div className="text-xs text-dim">
                        {gameTypeLabel(h.gameType)} · {new Date(h.playedAt).toLocaleString()}
                      </div>
                    </div>
                    <span className={`badge ${h.placed === 1 ? 'badge-success' : ''}`}>
                      #{h.placed}
                    </span>
                    <span style={{ fontWeight: 700 }}>{h.score} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.18s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Discord ad (hosts only)</h2>
            <div className="col" style={{ gap: 8 }}>
              <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={ad.enabled}
                  onChange={(e) => setAd({ ...ad, enabled: e.target.checked })}
                />
                <span className="text-sm">Show Discord banner across the site</span>
              </label>
              <input
                className="input"
                value={ad.title}
                onChange={(e) => setAd({ ...ad, title: e.target.value })}
                placeholder="Title"
                maxLength={80}
              />
              <input
                className="input"
                value={ad.subtitle}
                onChange={(e) => setAd({ ...ad, subtitle: e.target.value })}
                placeholder="Subtitle"
                maxLength={160}
              />
              <input
                className="input"
                value={ad.url}
                onChange={(e) => setAd({ ...ad, url: e.target.value })}
                placeholder="https://discord.gg/…"
                maxLength={300}
              />
              <div className="row" style={{ gap: 8 }}>
                <input ref={adFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAdImageFile} />
                <button className="btn btn-ghost text-sm" onClick={() => adFileRef.current?.click()}>
                  Upload image
                </button>
                {ad.imageUrl && (
                  <img src={ad.imageUrl} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                )}
              </div>
              <button className="btn btn-primary btn-block" onClick={handleSaveAd}>
                Save ad
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
