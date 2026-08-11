import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface DiscordAdData {
  enabled: boolean;
  title: string;
  subtitle: string;
  url: string;
  imageUrl: string | null;
}

const FALLBACK: DiscordAdData = {
  enabled: false,
  title: 'Join our Discord',
  subtitle: 'Hang out, find parties and get game news.',
  url: 'https://discord.gg/partyverse',
  imageUrl: null,
};

export default function DiscordAd() {
  const [ad, setAd] = useState<DiscordAdData | null>(null);

  useEffect(() => {
    api<{ ad: DiscordAdData }>('/api/ads')
      .then((data) => setAd(data.ad))
      .catch(() => setAd(FALLBACK));
  }, []);

  if (!ad || !ad.enabled) return null;

  return (
    <a
      href={ad.url}
      target="_blank"
      rel="noreferrer"
      className="glass"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 18px',
        marginBottom: 20,
        borderRadius: 14,
        borderColor: 'rgba(114,137,218,0.5)',
        background: 'linear-gradient(135deg, rgba(88,101,242,0.16), rgba(124,58,237,0.12))',
      }}
    >
      {ad.imageUrl ? (
        <img
          src={ad.imageUrl}
          alt=""
          style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            background: 'rgba(88,101,242,0.3)',
            flexShrink: 0,
          }}
        >
          💬
        </div>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{ad.title}</div>
        <div className="text-sm" style={{ opacity: 0.75 }}>
          {ad.subtitle}
        </div>
      </div>
      <span className="badge badge-success" style={{ flexShrink: 0 }}>
        Join
      </span>
    </a>
  );
}
