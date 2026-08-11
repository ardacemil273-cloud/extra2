import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../api/client';

export default function Register() {
  const { register } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref') ?? undefined;
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast('Passwords do not match.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await register(username.trim(), email.trim(), password, referralCode);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Registration failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="glass-strong auth-card animate-in">
        <div className="row" style={{ marginBottom: 20 }}>
          <span className="logo-mark">P</span>
          <div>
            <h1 className="auth-title">Join the party</h1>
            <p className="text-dim text-sm">Create your PartyVerse account</p>
          </div>
        </div>
        {referralCode && (
          <div className="badge badge-cyan mb-2" style={{ marginBottom: 12 }}>
            🎁 You were invited — a bonus awaits your friend!
          </div>
        )}
        <form onSubmit={handleSubmit} className="col">
          <div>
            <label className="field-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="partygoer"
              autoComplete="username"
              minLength={3}
              maxLength={20}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting}>
            {submitting ? <span className="spinner" /> : 'Create account'}
          </button>
        </form>
        <p className="text-sm text-dim mt-2" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
