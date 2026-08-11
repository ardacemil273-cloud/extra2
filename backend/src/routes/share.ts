import type { Request, Response } from 'express';
import { Router } from 'express';
import { prisma } from '../prisma';
import { getGame } from '../games/registry';

const router = Router();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function loadShareSummary(historyId: string) {
  const history = await prisma.gameHistory.findUnique({
    where: { id: historyId },
    include: {
      results: {
        include: { user: { select: { username: true, avatarColor: true, avatarUrl: true, level: true } } },
        orderBy: { placed: 'asc' },
      },
    },
  });
  if (!history) return null;
  const def = getGame(history.gameType);
  const winners = history.results.filter((r) => r.placed === 1).map((r) => r.user.username);
  let awards: { emoji: string; title: string; userId?: string; detail?: string }[] = [];
  if (Array.isArray(history.awards)) {
    awards = history.awards as { emoji: string; title: string; userId?: string; detail?: string }[];
  } else if (typeof history.awards === 'string') {
    try {
      const parsed = JSON.parse(history.awards);
      if (Array.isArray(parsed)) awards = parsed;
    } catch {
      awards = [];
    }
  }
  const resolvedAwards = awards.map((a) => {
    const user = a.userId ? history.results.find((r) => r.userId === a.userId)?.user : undefined;
    return { ...a, username: user?.username ?? null };
  });
  return {
    id: history.id,
    roomName: history.roomName,
    gameType: history.gameType,
    gameLabel: def?.label ?? history.gameType,
    gameIcon: def?.icon ?? '🎮',
    playedAt: history.playedAt,
    players: history.results.map((r) => ({
      username: r.user.username,
      avatarColor: r.user.avatarColor,
      avatarUrl: r.user.avatarUrl,
      level: r.user.level,
      score: r.score,
      placed: r.placed,
    })),
    winners,
    awards: resolvedAwards,
  };
}

router.get('/api/share/:historyId', async (req: Request, res: Response) => {
  const historyId = typeof req.params.historyId === 'string' ? req.params.historyId : '';
  if (!historyId || !/^[a-z0-9]{20,30}$/i.test(historyId)) {
    res.status(404).json({ error: 'not-found', message: 'Share link not found.' });
    return;
  }
  const summary = await loadShareSummary(historyId);
  if (!summary) {
    res.status(404).json({ error: 'not-found', message: 'Share link not found.' });
    return;
  }
  res.json(summary);
});

router.get('/share/:historyId', async (req: Request, res: Response) => {
  const historyId = typeof req.params.historyId === 'string' ? req.params.historyId : '';
  if (!historyId || !/^[a-z0-9]{20,30}$/i.test(historyId)) {
    res.status(404).type('html').send('<h1>404 — share link not found</h1>');
    return;
  }
  const summary = await loadShareSummary(historyId);
  if (!summary) {
    res.status(404).type('html').send('<h1>404 — share link not found</h1>');
    return;
  }
  const winnerText = summary.winners.length > 0 ? `${summary.winners.join(', ')} won ` : 'Game finished: ';
  const ogTitle = `${winnerText}${summary.gameLabel} on PartyVerse`;
  const ogDesc =
    summary.awards.length > 0
      ? `${summary.players.length} players, ${summary.awards.length} chaotic awards. Join the party!`
      : `${summary.players.length} players battled it out. Join the party!`;
  const rows = summary.players
    .map(
      (p, i) =>
        `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2a2540;">
          <span>${i + 1}. ${escapeHtml(p.username)}</span><span>${p.score} pts</span>
        </div>`,
    )
    .join('');
  const awardRows = summary.awards
    .map(
      (a) =>
        `<div style="padding:6px 0;font-size:14px;">${a.emoji} <b>${escapeHtml(a.title)}</b>${
          a.username ? ` — ${escapeHtml(a.username)}` : ''
        }</div>`,
    )
    .join('');
  res
    .status(200)
    .type('html')
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<meta property="og:title" content="${escapeHtml(ogTitle)}"/>
<meta property="og:description" content="${escapeHtml(ogDesc)}"/>
<meta property="og:type" content="website"/>
<title>${escapeHtml(ogTitle)}</title>
<style>
  body { margin:0; font-family: system-ui, -apple-system, sans-serif; background:#0d0b1e; color:#eee; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { width:min(520px, 92vw); background:linear-gradient(160deg,#1b1633,#141029); border:1px solid #2a2540; border-radius:20px; padding:28px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  h1 { font-size:22px; margin:0 0 6px; }
  .sub { color:#9ca3c7; margin-bottom:18px; font-size:14px; }
  .winner { color:#a855f7; font-weight:700; }
  .cta { display:block; text-align:center; margin-top:20px; padding:14px; border-radius:12px; background:linear-gradient(90deg,#a855f7,#22d3ee); color:#0d0b1e; font-weight:700; text-decoration:none; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(summary.gameIcon)} ${escapeHtml(ogTitle)}</h1>
    <div class="sub">${escapeHtml(summary.roomName)} · ${escapeHtml(ogDesc)}</div>
    <div>${rows}</div>
    ${awardRows ? `<div style="margin-top:14px;border-top:1px solid #2a2540;padding-top:10px;">${awardRows}</div>` : ''}
    <a class="cta" href="/">Play PartyVerse →</a>
  </div>
</body>
</html>`);
});

export default router;
