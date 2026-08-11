const BAD_WORDS = [
  'fuck', 'fucking', 'fucker', 'fuckoff', 'shit', 'shitting', 'shitty',
  'bitch', 'bitching', 'bastard', 'asshole', 'asshat', 'dick', 'dickhead',
  'cock', 'cocksucker', 'pussy', 'cunt', 'whore', 'slut', 'nigger', 'nigga',
  'faggot', 'fag', 'retard', 'retarded', 'tranny', 'twat', 'wanker', 'prick',
  'douche', 'douchebag', 'motherfucker', 'motherfucking', 'bullshit',
  'bollocks', 'arsehole', 'goddamn', 'damn', 'damnit', 'hell',
  'kill yourself', 'kys', 'sexting', 'pedophile', 'nazi', 'heil hitler',
  'rape', 'raped', 'rapist',
];

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(s: string): string {
  return s.replace(ESCAPE_RE, '\\$&');
}

function buildMatcher(): RegExp {
  const sorted = [...BAD_WORDS].sort((a, b) => b.length - a.length);
  const pattern = sorted
    .map((w) =>
      w
        .split('')
        .map((ch) => escapeRegExp(ch))
        .join('\\s*'),
    )
    .join('|');
  return new RegExp(`\\b(?:${pattern})\\b`, 'gi');
}

const MATCHER = buildMatcher();

function mask(match: string): string {
  if (match.length <= 1) return match;
  return match[0] + '*'.repeat(match.length - 1);
}

export function censor(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.replace(MATCHER, mask);
}

export function isClean(text: string): boolean {
  return typeof text === 'string' && text.length > 0 && censor(text) === text;
}
