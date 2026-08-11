import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';

const QUICK_REACTIONS = ['😂', '🔥', '🎉', '🤯', '❤️', '👏'];

export default function ChatPanel() {
  const { user } = useAuth();
  const { room, chatMessages, reactions, sendChat, sendReaction } = useRealtime();
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  if (!room) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    sendChat(value);
    setText('');
  };

  const recentReactions = reactions.slice(-8);

  return (
    <div className="glass stat-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 260 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ fontSize: 16 }}>Party chat</h2>
        {recentReactions.length > 0 && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {recentReactions.map((r) => (
              <span
                key={r.id}
                title={r.username}
                className="text-sm"
                style={{ fontSize: 18, animation: 'pop 0.3s ease' }}
              >
                {r.emoji}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="col"
        style={{ flex: 1, overflowY: 'auto', gap: 6, minHeight: 120, maxHeight: 220, paddingRight: 4 }}
      >
        {chatMessages.length === 0 ? (
          <p className="text-xs text-dim" style={{ textAlign: 'center', paddingTop: 24 }}>
            No messages yet. Say hi!
          </p>
        ) : (
          chatMessages.map((m) => {
            const mine = m.userId === user?.id;
            return (
              <div key={m.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div
                  className="avatar"
                  style={{ width: 24, height: 24, fontSize: 11, background: m.avatarColor, flexShrink: 0 }}
                >
                  {m.username.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="username-link text-xs"
                      style={{ fontWeight: 700, color: mine ? 'var(--neon-cyan)' : undefined, fontSize: 12 }}
                      onClick={() => navigate(`/user/${encodeURIComponent(m.username)}`)}
                    >
                      {m.username}
                    </button>
                  </div>
                  <div className="text-sm" style={{ wordBreak: 'break-word' }}>
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: 18 }}
            title="Send reaction"
          >
            {emoji}
          </button>
        ))}
      </div>

      <form onSubmit={handleSend} className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          maxLength={280}
          style={{ flex: 1 }}
        />
        <button className="btn btn-cyan" type="submit" disabled={text.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}
