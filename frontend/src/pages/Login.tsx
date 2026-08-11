import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError } from '../api/client';

export default function Login() {
  const { login } = useAuth();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Login failed.', 'error');
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
            <h1 className="auth-title">Welcome back</h1>
            <p className="text-dim text-sm">Sign in to PartyVerse</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="col">
          <div>
            <label className="field-label" htmlFor="identifier">
              Username or email
            </label>
            <input
              id="identifier"
              className="input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="partygoer"
              autoComplete="username"
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
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting}>
            {submitting ? <span className="spinner" /> : 'Sign in'}
          </button>
        </form>
        <p className="text-sm text-dim mt-2" style={{ textAlign: 'center' }}>
          New to PartyVerse? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
