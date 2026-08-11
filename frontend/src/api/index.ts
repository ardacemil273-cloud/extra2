import { api } from './client';
import type {
  ActiveRoom,
  DailyClaimResult,
  GameMeta,
  NotificationInfo,
  RecentRoom,
  Recommendation,
  RoomState,
  ShareSummary,
  User,
} from '../types';

export interface AuthResponse {
  token: string;
  user: User;
}

export function register(
  username: string,
  email: string,
  password: string,
  referralCode?: string,
): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { username, email, password, referralCode },
    auth: false,
  });
}

export function login(identifier: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { identifier, password },
    auth: false,
  });
}

export function fetchMe(): Promise<{ user: User; recentRooms: RecentRoom[] }> {
  return api('/api/auth/me');
}

export function createRoom(options?: {
  name?: string;
  password?: string;
  maxPlayers?: number | null;
  gameType?: string | null;
}): Promise<{ room: RoomState }> {
  return api<{ room: RoomState }>('/api/rooms', {
    method: 'POST',
    body: options ?? {},
  });
}

export function fetchActiveRooms(): Promise<{ rooms: ActiveRoom[] }> {
  return api('/api/rooms/active');
}

export function fetchGames(): Promise<{ games: GameMeta[] }> {
  return api('/api/games');
}

export function fetchInvite(roomId: string): Promise<{
  invite: { code: string; token: string; url: string; hasPassword: boolean };
}> {
  return api(`/api/rooms/${roomId}/invite`);
}

export function fetchInviteByToken(token: string): Promise<{
  invite: {
    code: string;
    name: string;
    hasPassword: boolean;
    password: string | null;
    status: string;
    gameType: string | null;
    state: RoomState;
  };
}> {
  return api(`/api/rooms/invite/${token}`);
}

export function fetchProfile(): Promise<{
  user: {
    id: string;
    username: string;
    avatarColor: string;
    avatarUrl: string | null;
    xp: number;
    level: number;
    dailyStreak: number;
  };
  progress: { xpIntoLevel: number; needed: number; level: number };
}> {
  return api('/api/social/profile');
}

export function fetchFriends(): Promise<{
  friends: import('../types').FriendUser[];
  requests: { id: string; username: string; avatarColor: string; avatarUrl: string | null }[];
}> {
  return api('/api/social/friends');
}

export function addFriend(username: string): Promise<{ ok: boolean }> {
  return api('/api/social/friends', { method: 'POST', body: { username } });
}

export function acceptFriend(friendId: string): Promise<{ ok: boolean }> {
  return api(`/api/social/friends/${friendId}/accept`, { method: 'POST' });
}

export function removeFriend(friendId: string): Promise<{ ok: boolean }> {
  return api(`/api/social/friends/${friendId}`, { method: 'DELETE' });
}

export function fetchLeaderboard(): Promise<{
  leaderboard: import('../types').LeaderboardEntry[];
}> {
  return api('/api/social/leaderboard');
}

export function fetchAchievements(): Promise<{
  achievements: import('../types').AchievementInfo[];
}> {
  return api('/api/social/achievements');
}

export function fetchHistory(): Promise<{ history: import('../types').HistoryEntry[] }> {
  return api('/api/social/history');
}

export function fetchChallenges(): Promise<{
  streak: number;
  challenges: import('../types').DailyChallengeInfo[];
}> {
  return api('/api/social/challenges');
}

export function fetchDiscordAd(): Promise<{
  ad: { enabled: boolean; title: string; subtitle: string; url: string; imageUrl: string | null };
}> {
  return api('/api/ads');
}

export function updateDiscordAd(ad: {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  url?: string;
}): Promise<{ ad: { enabled: boolean; title: string; subtitle: string; url: string; imageUrl: string | null } }> {
  return api('/api/ads', { method: 'PUT', body: ad });
}

export function uploadAdImage(dataUrl: string): Promise<{
  ad: { enabled: boolean; title: string; subtitle: string; url: string; imageUrl: string | null };
  url: string;
}> {
  return api('/api/ads/image', { method: 'POST', body: { dataUrl } });
}

export function uploadAvatar(dataUrl: string): Promise<{ avatarUrl: string }> {
  return api('/api/ads/avatar', { method: 'POST', body: { dataUrl } });
}

export function claimDaily(): Promise<DailyClaimResult> {
  return api('/api/social/claim-daily', { method: 'POST' });
}

export function fetchNotifications(): Promise<{ notifications: NotificationInfo[]; unread: number }> {
  return api('/api/social/notifications');
}

export function markNotificationsRead(ids?: string[]): Promise<{ ok: boolean }> {
  return api('/api/social/notifications/read', { method: 'POST', body: { ids } });
}

export function reportUser(targetUserId: string, reason: string, details?: string, roomId?: string): Promise<{ ok: boolean }> {
  return api('/api/social/report', {
    method: 'POST',
    body: { targetUserId, reason, details, roomId },
  });
}

export function fetchRecommendations(): Promise<{ recommendations: Recommendation[] }> {
  return api('/api/social/recommendations');
}

export function fetchShare(historyId: string): Promise<ShareSummary> {
  return api(`/api/share/${historyId}`, { auth: false });
}

export function fetchSeason(): Promise<import('../types').SeasonStatus> {
  return api('/api/social/season');
}

export function claimSeasonTitle(): Promise<{ ok: boolean; title: string | null }> {
  return api('/api/social/season/claim-title', { method: 'POST' });
}

export function fetchReferral(): Promise<import('../types').ReferralInfo> {
  return api('/api/social/referral');
}

export function updateProfile(data: {
  bio?: string;
  title?: string;
  interests?: string[];
}): Promise<{ profile: { id: string; title: string; bio: string; interests: string[]; unlockedTitles: string[] } }> {
  return api('/api/social/profile', { method: 'PUT', body: data });
}

export function fetchPublicUser(username: string): Promise<{
  profile: import('../types').PublicUserProfile;
  isMe: boolean;
}> {
  return api(`/api/social/users/${encodeURIComponent(username)}`);
}
