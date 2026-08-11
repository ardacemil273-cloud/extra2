import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { useRealtime } from '../context/RealtimeContext';
import { fetchInviteByToken } from '../api';
import { ApiError } from '../api/client';

export default function Join() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { joinRoomWithOptions } = useRealtime();
  const [info, setInfo] = useState<{ code: string; name: string; hasPassword: boolean; status: string } | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetchInviteByToken(token)
      .then((data) => {
        setInfo(data.invite);
        if (!data.invite.hasPassword) {
          joinRoomWithOptions({ code: data.invite.code });
          navigate('/lobby');
        }
      })
      .catch((err) => {
        toast(err instanceof ApiError ? err.message : 'Invite link is invalid.', 'error');
        navigate('/dashboard');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;
    if (info.hasPassword && password.trim().length === 0) {
      toast('This room requires a password.', 'error');
      return;
    }
    joinRoomWithOptions({ code: info.code, password: password.trim() });
    navigate('/lobby');
  };

  if (loading) {
    return (
      <main className="center" style={{ minHeight: '60vh' }}>
        <div className="col center">
          <div className="spinner" />
          <p className="text-dim">Resolving invite…</p>
        </div>
      </main>
    );
  }

  if (!info) return null;

  return (
    <main className="center" style={{ minHeight: '60vh' }}>
      <div className="glass-strong" style={{ padding: 32, maxWidth: 420, width: '100%' }}>
        <h2 style={{ fontSize: 24, textAlign: 'center' }}>{info.name}</h2>
        <p className="text-dim text-sm" style={{ textAlign: 'center', margin: '8px 0 20px' }}>
          You're invited to join room <strong style={{ letterSpacing: '0.15em' }}>{info.code}</strong>
        </p>
        {info.hasPassword ? (
          <form onSubmit={handleJoin} className="col">
            <input
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Room password"
              type="password"
              autoFocus
            />
            <button className="btn btn-primary btn-block" type="submit" disabled={password.trim().length === 0}>
              Join with password
            </button>
          </form>
        ) : (
          <p className="text-xs text-dim" style={{ textAlign: 'center' }}>
            Joining…
          </p>
        )}
      </div>
    </main>
  );
}
