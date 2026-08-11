import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { acceptFriend, addFriend, fetchPublicUser, removeFriend, reportUser } from '../api';
import { ApiError } from '../api/client';
import type { PublicUserProfile } from '../types';

const GAME_LABELS: Record<string, string> = {
  quiz: 'Brain Battle',
  reaction: 'Fastest Finger',
  rps: 'RPS Battle Royale',
  draw: 'Draw & Guess',
  telephone: 'Telephone',
  sabotaj: 'Sabotaj',
  chameleon: 'Chameleon',
  reveal: 'Reveal',
};

const REPORT_REASONS = [
  { key: 'abusive-language', label: 'Abusive language' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'spam', label: 'Spam' },
  { key: 'inappropriate-content', label: 'Inappropriate content' },
  { key: 'cheating', label: 'Cheating' },
  { key: 'other', label: 'Other' },
];

export default function PublicProfile() {
  const { username } = useParams<{ username: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMe, setIsMe] = useState(false);
  const [friendState, setFriendState] = useState<{ status: 'none' | 'pending' | 'friends'; sent: boolean }>({ status: 'none', sent: false });

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('abusive-language');
  const [reportDetails, setReportDetails] = useState('');
  const [reporting, setReporting] = useState(false);

  const load = () => {
    if (!username) return;
    setLoading(true);
    void fetchPublicUser(username)
      .then((data) => {
        setProfile(data.profile);
        setIsMe(data.isMe);
        setFriendState({
          status: data.profile.isFriend ? 'friends' : data.profile.hasPendingRequest ? 'pending' : 'none',
          sent: data.profile.hasPendingRequest,
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'User not found.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setProfile(null);
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const handleAddFriend = () => {
    if (!profile) return;
    addFriend(profile.username)
      .then(() => {
        setFriendState({ status: 'pending', sent: true });
        toast('Friend request sent!', 'success');
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not add friend.', 'error'));
  };

  const handleAccept = () => {
    if (!profile) return;
    acceptFriend(profile.id)
      .then(() => {
        setFriendState({ status: 'friends', sent: false });
        toast('Friend added!', 'success');
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not accept.', 'error'));
  };

  const handleRemove = () => {
    if (!profile) return;
    removeFriend(profile.id)
      .then(() => {
        setFriendState({ status: 'none', sent: false });
        toast('Friend removed.', 'success');
      })
      .catch(() => undefined);
  };

  const handleReport = () => {
    if (!profile) return;
    setReporting(true);
    reportUser(profile.id, reportReason, reportDetails.trim() || undefined)
      .then(() => {
        toast('Report submitted. Our team will review it.', 'success');
        setReportOpen(false);
        setReportDetails('');
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : 'Could not submit report.', 'error'))
      .finally(() => setReporting(false));
  };

  if (loading) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="col center">
          <div className="spinner" />
          <p className="text-dim">Loading profile…</p>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="glass-strong" style={{ padding: 32, maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>User not found</h2>
          <p className="text-dim text-sm">{error ?? 'This player does not exist.'}</p>
          <button className="btn btn-primary btn-block mt-2" onClick={() => navigate('/dashboard')}>
            Back to dashboard
          </button>
        </div>
      </main>
    );
  }

  const winRate = profile.gamesPlayed > 0 ? profile.winRate : 0;

  return (
    <main className="container" style={{ paddingBottom: 48 }}>
      <h1 className="page-title">Player profile</h1>
      <div className="dashboard-grid">
        <section className="col">
          <div className="glass stat-card animate-in">
            <div className="row">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="avatar" style={{ width: 64, height: 64, objectFit: 'cover' }} />
              ) : (
                <div className="avatar" style={{ width: 64, height: 64, fontSize: 28, background: profile.avatarColor }}>
                  {profile.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="grow">
                <h2 style={{ fontSize: 22 }}>
                  {profile.username}
                  {profile.title && <span className="badge" style={{ marginLeft: 8 }}>{profile.title}</span>}
                </h2>
                <p className="text-dim text-sm">
                  Level {profile.level} · {profile.xp} XP · {profile.dailyStreak} day streak 🔥
                </p>
                {profile.bio && <p className="text-sm" style={{ marginTop: 6 }}>{profile.bio}</p>}
                {profile.interests.length > 0 && (
                  <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {profile.interests.map((i) => (
                      <span key={i} className="badge">{i}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="divider" />

            <div className="col">
              {!isMe && friendState.status === 'none' && (
                <button className="btn btn-cyan btn-block" onClick={handleAddFriend}>
                  {friendState.sent ? 'Request sent' : 'Add friend'}
                </button>
              )}
              {!isMe && friendState.status === 'pending' && (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-success" style={{ flex: 1 }} onClick={handleAccept}>
                    Accept request
                  </button>
                  <button className="btn btn-ghost" onClick={handleRemove}>
                    Decline
                  </button>
                </div>
              )}
              {!isMe && friendState.status === 'friends' && (
                <button className="btn btn-danger btn-block" onClick={handleRemove}>
                  Remove friend
                </button>
              )}

              {!isMe && (
                <button className="btn btn-ghost text-sm" onClick={() => setReportOpen(true)}>
                  🚩 Report player
                </button>
              )}
            </div>
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.08s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Stats</h2>
            <div className="col">
              <div className="score-row">
                <span className="text-dim">Games played</span>
                <span style={{ fontWeight: 700 }}>{profile.gamesPlayed}</span>
              </div>
              <div className="score-row">
                <span className="text-dim">Wins</span>
                <span style={{ fontWeight: 700 }}>{profile.wins}</span>
              </div>
              <div className="score-row">
                <span className="text-dim">Win rate</span>
                <span style={{ fontWeight: 700 }}>%{winRate}</span>
              </div>
              <div className="score-row">
                <span className="text-dim">Favorite game</span>
                <span style={{ fontWeight: 700 }}>
                  {profile.favoriteGame ? (GAME_LABELS[profile.favoriteGame] ?? profile.favoriteGame) : '—'}
                </span>
              </div>
              <div className="score-row">
                <span className="text-dim">Joined</span>
                <span style={{ fontWeight: 600 }}>{new Date(profile.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="col">
          <div className="glass stat-card animate-in" style={{ animationDelay: '0.06s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Achievements</h2>
            {profile.achievements.length === 0 ? (
              <div className="empty-state">
                <p>No achievements yet.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {profile.achievements.map((a) => (
                  <div key={a.key} className="score-row">
                    <span style={{ fontSize: 20 }}>{a.icon}</span>
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                    </div>
                    <span className="text-xs text-dim">+{a.xpReward} XP</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass stat-card animate-in" style={{ animationDelay: '0.1s' }}>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Recent games</h2>
            {profile.recentGames.length === 0 ? (
              <div className="empty-state">
                <p>No games played yet.</p>
              </div>
            ) : (
              <div className="col" style={{ gap: 6 }}>
                {profile.recentGames.map((g, i) => (
                  <div key={i} className="score-row">
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{g.roomName}</div>
                      <div className="text-xs text-dim">
                        {GAME_LABELS[g.gameType] ?? g.gameType} · {new Date(g.playedAt).toLocaleString()}
                      </div>
                    </div>
                    <span className={`badge ${g.placed === 1 ? 'badge-success' : ''}`}>#{g.placed}</span>
                    <span style={{ fontWeight: 700 }}>{g.score} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {reportOpen && (
        <div className="modal-backdrop" onClick={() => setReportOpen(false)}>
          <div className="modal glass-strong" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Report {profile.username}</h2>
            <p className="text-dim text-sm mb-2">
              Reports are reviewed by our team. Repeat offenders get restricted or banned.
            </p>
            <div className="col">
              <select className="input" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
                {REPORT_REASONS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <textarea
                className="input"
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Add details (optional)"
                maxLength={500}
                rows={3}
              />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleReport} disabled={reporting}>
                  {reporting ? <span className="spinner" /> : 'Submit report'}
                </button>
                <button className="btn btn-ghost" onClick={() => setReportOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
