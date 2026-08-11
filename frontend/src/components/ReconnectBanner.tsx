import { useRealtime } from '../context/RealtimeContext';

export default function ReconnectBanner() {
  const { reconnecting, connected } = useRealtime();
  if (!reconnecting) return null;
  return (
    <div
      style={{
        background: 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
        borderBottom: '1px solid rgba(245,158,11,0.4)',
        color: '#fcd34d',
        padding: '8px 16px',
        fontSize: 13,
        textAlign: 'center',
        fontWeight: 600,
      }}
    >
      {connected
        ? 'Reconnected — syncing room state…'
        : 'Connection lost — reconnecting…'}
    </div>
  );
}
