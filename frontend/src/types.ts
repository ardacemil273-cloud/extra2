export type GameType =
  | 'quiz'
  | 'reaction'
  | 'rps'
  | 'draw'
  | 'telephone'
  | 'sabotaj'
  | 'chameleon'
  | 'reveal';

export type RoomVibe = 'friends' | 'spice' | 'chaos' | 'mixed';

export interface User {
  id: string;
  username: string;
  email: string;
  avatarColor: string;
  avatarUrl: string | null;
  title: string;
  bio: string;
  interests: string[];
  seasonXp: number;
  xp: number;
  level: number;
  dailyStreak: number;
  createdAt: string;
}

export interface PlayerPublic {
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  isSpectator: boolean;
  muted: boolean;
  score: number;
}

export interface RoomStatus {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'lobby' | 'playing' | 'finished';
  gameType: GameType | null;
  vibe: RoomVibe;
  isPrivate: boolean;
  hasPassword: boolean;
  maxPlayers: number | null;
  createdAt: string;
}

export interface RoomState {
  room: RoomStatus;
  players: PlayerPublic[];
  spectators: PlayerPublic[];
}

export interface ChatMessagePublic {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  text: string;
  createdAt: string;
}

export interface ReactionPublic {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  emoji: string;
  createdAt: string;
}

export interface GameResultEntry {
  userId: string;
  username: string;
  avatarColor: string;
  score: number;
  placed: number;
}

export interface GamePlayerResult extends GameResultEntry {
  xpGained: number;
  seasonXpGained: number;
  levelBefore: number;
  levelAfter: number;
  newAchievements: string[];
  newTitle?: string | null;
}

export interface GameMeta {
  type: GameType;
  label: string;
  description: string;
  icon: string;
  minPlayers: number;
  maxPlayers: number | null;
}

export interface RecentRoom {
  id: string;
  code: string;
  name: string;
  gameType: string | null;
  status: string;
  playedAt: string;
}

export interface ActiveRoom {
  id: string;
  code: string;
  name: string;
  status: string;
  gameType: string | null;
  isPrivate: boolean;
  playerCount: number;
  ownerId: string;
  createdAt: string;
}

// ---------- Quiz ----------
export interface QuizState {
  type: 'quiz';
  phase: 'countdown' | 'question' | 'reveal' | 'leaderboard' | 'finished';
  round: number;
  totalRounds: number;
  question: { text: string; options: string[]; category: string } | null;
  correctIndex: number | null;
  revealed: boolean;
  players: Record<string, { score: number; answered: boolean }>;
  order: string[];
  timePerQuestionMs: number;
}

// ---------- Reaction ----------
export interface ReactionState {
  type: 'reaction';
  phase: 'countdown' | 'awaiting' | 'result' | 'finished';
  round: number;
  totalRounds: number;
  signalAt: number | null;
  players: Record<string, { wins: number; bestMs: number | null; playedRounds: number }>;
  order: string[];
  roundTimes: Record<string, number | null> | null;
  roundWinner: string | null;
  responseWindowMs: number;
}

// ---------- RPS ----------
export type RpsChoice = 'rock' | 'paper' | 'scissors';

export interface RpsState {
  type: 'rps';
  phase: 'round' | 'reveal' | 'finished';
  round: number;
  targetScore: number;
  players: Record<
    string,
    { score: number; wins: number; ties: number; currentChoice: RpsChoice | null }
  >;
  order: string[];
  outcomes: Record<string, { wins: string[]; loses: string[]; ties: string[] }> | null;
  roundWinnerIds: string[];
  roundTimeoutMs: number;
}

// ---------- Draw & Guess ----------
export interface DrawPlayerEntry {
  score: number;
  guessed: boolean;
}

export interface DrawStroke {
  from: string;
  points: { x: number; y: number }[];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
}

export interface DrawState {
  type: 'draw';
  phase: 'countdown' | 'drawing' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  drawerId: string;
  wordPattern: string | null;
  word: string | null;
  hint: string | null;
  players: Record<string, DrawPlayerEntry>;
  order: string[];
  roundEndAt: number;
  timerMs: number;
  revealed: boolean;
  isDrawer?: boolean;
}

// ---------- Telephone ----------
export type TelephoneStep = {
  kind: 'prompt' | 'caption' | 'draw';
  text?: string;
  strokes?: Stroke[];
};

export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  size: number;
  tool: 'pen' | 'eraser';
}

export interface TelephoneState {
  type: 'telephone';
  phase: 'countdown' | 'prompt' | 'draw' | 'caption' | 'reveal' | 'finished';
  stepIndex: number;
  totalSteps: number;
  kind: 'prompt' | 'caption' | 'draw' | null;
  players: Record<string, { score: number; submitted: boolean }>;
  order: string[];
  roundEndAt: number;
  timerMs: number;
  pages: { ownerId: string; steps: TelephoneStep[] }[] | null;
  votes: Record<string, string> | null;
  page?: { ownerId: string; history: TelephoneStep[] } | null;
  me?: { submitted: boolean };
}

// ---------- Sabotaj ----------
export type SabotajRole = 'crew' | 'saboteur';

export interface SabotajStation {
  progress: number;
  fixed: boolean;
  sabotaged: boolean;
}

export interface SabotajState {
  type: 'sabotaj';
  phase: 'countdown' | 'action' | 'result' | 'discussion' | 'vote' | 'voteResult' | 'finished';
  round: number;
  maxRounds: number;
  stations: SabotajStation[];
  players: Record<
    string,
    { submitted: boolean; voted: boolean; ejected: boolean; role: SabotajRole | null }
  >;
  order: string[];
  fixedCount: number;
  sabotageCount: number;
  stationTarget: number;
  sabotageTarget: number;
  ejectedId: string | null;
  ejectedRole: SabotajRole | null;
  winner: SabotajRole | null;
  roundEndAt: number;
  timerMs: number;
  me?: { role: SabotajRole | null; choice: number | null; voteTarget: string | null; ejected: boolean };
}

// ---------- Chameleon ----------
export interface ChameleonPlayerEntry {
  score: number;
  clue: string | null;
}

export interface ChameleonState {
  type: 'chameleon';
  phase: 'countdown' | 'clue' | 'vote' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  category: string;
  word: string | null;
  chameleonId: string | null;
  clueOrder: string[] | null;
  clueIndex: number;
  currentClueId: string | null;
  players: Record<string, ChameleonPlayerEntry>;
  order: string[];
  timerMs: number;
  roundEndAt: number;
  votesByTarget: Record<string, string[]> | null;
  caught: boolean | null;
  me?: {
    isChameleon: boolean;
    word: string | null;
    caught: boolean | null;
    vote: string | null;
  };
}

// ---------- Reveal ----------
export interface RevealPlayerEntry {
  score: number;
  answer: string | null;
  hasAnswered: boolean;
}

export interface RevealState {
  type: 'reveal';
  phase: 'countdown' | 'question' | 'vote' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  deck: RoomVibe;
  deckLabel: string;
  question: { text: string; vibe: string } | null;
  players: Record<string, RevealPlayerEntry>;
  order: string[];
  timerMs: number;
  roundEndAt: number;
  votesByTarget: Record<string, string[]> | null;
  winnerIds: string[] | null;
  me?: { answer: string | null; vote: string | null };
}

export type AnyGameState =
  | QuizState
  | ReactionState
  | RpsState
  | DrawState
  | TelephoneState
  | SabotajState
  | ChameleonState
  | RevealState;

export interface SocketError {
  code: string;
  message: string;
}

// ---------- Social ----------
export interface FriendUser {
  id: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  xp: number;
  level: number;
  playing: { id: string; code: string; name: string; status: string; gameType: string | null; playerCount: number } | null;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  xp: number;
  level: number;
  dailyStreak: number;
}

export interface AchievementInfo {
  key: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
  earned: boolean;
  earnedAt: string | null;
}

export interface HistoryEntry {
  id: string;
  roomName: string;
  gameType: string;
  playedAt: string;
  score: number;
  placed: number;
}

export interface DailyChallengeInfo {
  id: string;
  key: string;
  description: string;
  target: number;
  xpReward: number;
  progress: number;
  completed: boolean;
}

export interface ProfileInfo {
  user: LeaderboardEntry;
  progress: { xpIntoLevel: number; needed: number; level: number };
}

export interface GameAward {
  key: string;
  emoji: string;
  title: string;
  userId?: string;
  detail?: string;
}

export interface NotificationInfo {
  id: string;
  kind: 'friend_request' | 'friend_accepted' | 'room_invite' | 'achievement' | 'referral';
  actorId: string | null;
  payload: unknown;
  read: boolean;
  createdAt: string;
}

export interface DailyClaimResult {
  streak: number;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  alreadyClaimed: boolean;
  newAchievements: string[];
}

export interface Recommendation {
  type: GameType;
  label: string;
  reason: string;
  popular: number;
}

export interface ShareSummary {
  id: string;
  roomName: string;
  gameType: string;
  gameLabel: string;
  gameIcon: string;
  playedAt: string;
  players: {
    username: string;
    avatarColor: string;
    avatarUrl: string | null;
    level: number;
    score: number;
    placed: number;
  }[];
  winners: string[];
  awards: (GameAward & { username: string | null })[];
}

// ---------- Season ----------
export interface SeasonTier {
  xp: number;
  name: string;
  icon: string;
  title: string;
  color: string;
}

export interface SeasonStatus {
  season: { id: string; name: string; emoji: string; tiers: SeasonTier[] };
  xp: number;
  tier: SeasonTier;
  next: SeasonTier | null;
  needed: number;
  unlockedTitle: string | null;
  tiers: SeasonTier[];
}

export interface ReferralInfo {
  code: string | null;
  url: string | null;
  invitesAccepted: number;
  username: string;
}

export interface PublicUserProfile {
  id: string;
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  title: string;
  bio: string;
  interests: string[];
  xp: number;
  level: number;
  dailyStreak: number;
  createdAt: string;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  favoriteGame: string | null;
  recentGames: {
    roomName: string;
    gameType: string;
    playedAt: string;
    score: number;
    placed: number;
  }[];
  achievements: { key: string; name: string; icon: string; xpReward: number }[];
  isFriend: boolean;
  hasPendingRequest: boolean;
}
