import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useNavigate } from 'react-router-dom';
import NotificationBell from './NotificationBell';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { room } = useRealtime();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <button
          className="logo cursor-pointer"
          style={{ background: 'none', border: 'none', color: 'inherit' }}
          onClick={() => navigate('/dashboard')}
          aria-label="PartyVerse home"
        >
          <span className="logo-mark">P</span>
          <span>PartyVerse</span>
        </button>
        <nav className="nav-links">
          {room && (
            <button className="btn btn-ghost text-sm" onClick={() => navigate('/lobby')}>
              Room {room.room.code}
            </button>
          )}
          <NotificationBell />
          <button className="btn btn-ghost text-sm" onClick={() => navigate('/profile')}>
            {user?.username}
          </button>
          <button className="btn btn-ghost text-sm" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
