import type { AuthedSocket, GameType } from '../types';
import { prisma } from '../prisma';
import { getGame } from '../games/registry';
import { config } from '../config';
import { getPersonalSnapshot } from '../games/core';
import { createRoomForUser } from '../rooms/createRoom';
import { comparePassword, hashPassword } from '../utils/password';
import {
  getRoomByCode,
  getRoomById,
  getAllRooms,
  addPlayerToRoom,
  removePlayerFromRoom,
  getLivePlayer,
  getPlayerEntry,
  getSpectatorEntry,
  playerConnectedSocket,
  playerDisconnectedSocket,
  setReconnectTimer,
  joinSocketToRoom,
  joinSocketToUserRoom,
  leaveSocketRoom,
  emitToRoom,
  emitToUser,
  toRoomState,
  clearTimers,
  deleteLiveRoom,
  touchRoom,
  type LiveRoom,
  type LivePlayer,
} from './store';
import {
  upsertPlayer,
  deletePlayerRecord,
  setPlayerReady,
  setPlayerSpectator,
  setRoomGameType,
  setRoomStatus,
  transferRoomOwnership,
  closeRoom,
  persistChatMessage,
  persistReaction,
  setRoomPassword,
  setRoomMaxPlayers,
  setRoomVibe,
} from './persist';
import { censor } from '../utils/profanity';
import { createNotification } from '../social/notifications';
import type { RoomVibe } from '../types';

const MAX_CHAT_LEN = 200;
const MAX_CHAT_HISTORY = 100;
const MAX_REACTIONS = 60;
const EMOJI_RE = /^\p{Extended_Pictographic}+$/u;

function emitError(socket: AuthedSocket, code: string, message: string): void {
  socket.emit('error', { code, message });
}

export function sendRoomState(socket: AuthedSocket, room: LiveRoom): void {
  socket.emit('room:state', toRoomState(room));
}

export function sendGameState(socket: AuthedSocket, room: LiveRoom): void {
  if (!room.gameType || room.gameState === null) return;
  const def = getGame(room.gameType);
  if (!def) return;
  const state = getPersonalSnapshot(room, socket.data.user.userId);
  if (state !== null) socket.emit('game:state', state);
}

function broadcastRoomUpdate(room: LiveRoom): void {
  emitToRoom(room, 'room:update', toRoomState(room));
}

function attachSocketToRoom(socket: AuthedSocket, room: LiveRoom, userId: string, spectator: boolean): void {
  socket.data.roomId = room.id;
  socket.data.isSpectator = spectator;
  playerConnectedSocket(room, userId, socket.id);
  joinSocketToRoom(socket, room);
}

function detachSocketFromRoom(socket: AuthedSocket, room: LiveRoom, userId: string): void {
  playerDisconnectedSocket(room, userId, socket.id);
}

function transferHostIfNeeded(room: LiveRoom): void {
  const players = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  if (players.length === 0) return;
  if (players[0].userId === room.ownerId) return;
  const newHost = players[0];
  room.ownerId = newHost.userId;
  newHost.isHost = true;
  void transferRoomOwnership(room.id, newHost.userId).catch(() => undefined);
}

function isHost(room: LiveRoom, userId: string): boolean {
  return room.ownerId === userId;
}

function removePlayerFromGameState(room: LiveRoom, userId: string): void {
  const state = room.gameState as { players?: Record<string, unknown>; order?: string[] } | null;
  if (!state || !state.players || !state.order) return;
  if (!(userId in state.players)) return;
  delete state.players[userId];
  state.order = state.order.filter((id) => id !== userId);
}

function currentPlayerUsername(room: LiveRoom, userId: string): string {
  return room.players.get(userId)?.username ?? room.spectators.get(userId)?.username ?? userId;
}

export function registerRoomHandlers(socket: AuthedSocket): void {
  socket.on('room:join', (payload: { code?: unknown; password?: unknown; spectate?: unknown }) => {
    void handleJoin(socket, payload);
  });
  socket.on('room:rejoin', (payload: { roomId?: unknown }) => {
    void handleRejoin(socket, payload);
  });
  socket.on('room:leave', () => {
    void handleLeave(socket);
  });
  socket.on('room:ready', (payload: { ready?: unknown }) => {
    void handleReady(socket, payload);
  });
  socket.on('room:selectGame', (payload: { gameType?: unknown }) => {
    void handleSelectGame(socket, payload);
  });
  socket.on('room:start', () => {
    void handleStart(socket);
  });
  socket.on('room:restart', () => {
    void handleRestart(socket);
  });
  socket.on('room:returnToLobby', () => {
    void handleReturnToLobby(socket);
  });
  socket.on('room:spectate', (payload: { spectating?: unknown }) => {
    void handleSpectate(socket, payload);
  });
  socket.on('room:quickPlay', () => {
    void handleQuickPlay(socket);
  });
  socket.on('room:settings', (payload: { password?: unknown; maxPlayers?: unknown; vibe?: unknown }) => {
    void handleSettings(socket, payload);
  });
  socket.on('room:chat', (payload: { text?: unknown }) => {
    void handleChat(socket, payload);
  });
  socket.on('room:react', (payload: { emoji?: unknown }) => {
    void handleReaction(socket, payload);
  });
  socket.on('room:kick', (payload: { userId?: unknown }) => {
    void handleKick(socket, payload);
  });
  socket.on('room:mute', (payload: { userId?: unknown; muted?: unknown }) => {
    void handleMute(socket, payload);
  });
  socket.on('room:inviteFriend', (payload: { userId?: unknown }) => {
    void handleInviteFriend(socket, payload);
  });
  socket.on('game:action', (action: unknown) => {
    void handleGameAction(socket, action);
  });
}

async function handleJoin(
  socket: AuthedSocket,
  payload: { code?: unknown; password?: unknown; spectate?: unknown },
): Promise<void> {
  const user = socket.data.user;
  const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    emitError(socket, 'invalid-code', 'Invalid room code.');
    return;
  }
  const room = getRoomByCode(code);
  if (!room) {
    emitError(socket, 'room-not-found', 'Room not found.');
    return;
  }
  if (socket.data.roomId && socket.data.roomId !== room.id) {
    emitError(socket, 'already-in-room', 'You are already in a different room. Leave it first.');
    return;
  }
  const requestSpectate = payload?.spectate === true;
  const existing = getLivePlayer(room, user.userId);

  if (room.status === 'playing') {
    if (!requestSpectate && !existing) {
      emitError(socket, 'room-in-game', 'This game is already in progress.');
      return;
    }
    if (!existing) {
      const spectating = await joinAsSpectator(socket, room, user.userId);
      if (!spectating) return;
      return;
    }
  }

  if (room.isPrivate && room.passwordHash) {
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (password === '') {
      emitError(socket, 'password-required', 'This room is password protected.');
      return;
    }
    const ok = await comparePassword(password, room.passwordHash);
    if (!ok) {
      emitError(socket, 'wrong-password', 'Incorrect room password.');
      return;
    }
  }

  if (room.maxPlayers !== null && room.players.size >= room.maxPlayers) {
    if (!requestSpectate) {
      emitError(socket, 'room-full', 'This room is full.');
      return;
    }
  }

  if (existing) {
    if (existing.isSpectator && !requestSpectate) {
      existing.isSpectator = false;
      room.spectators.delete(user.userId);
      room.players.set(user.userId, existing);
      void setPlayerSpectator(room.id, user.userId, false).catch(() => undefined);
    }
    existing.connected = true;
    if (existing.reconnectTimer) {
      clearTimeout(existing.reconnectTimer);
      existing.reconnectTimer = null;
    }
    attachSocketToRoom(socket, room, user.userId, existing.isSpectator);
    if (existing.isSpectator) {
      const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
      if (dbUser) {
        existing.avatarUrl = dbUser.avatarUrl;
      }
    }
  } else {
    if (requestSpectate || room.status === 'playing') {
      await joinAsSpectator(socket, room, user.userId);
      return;
    }
    const dbUser = await prisma.user.findUnique({ where: { id: user.userId } });
    const player: LivePlayer = addPlayerToRoom(room, {
      userId: user.userId,
      username: user.username,
      avatarColor: dbUser?.avatarColor ?? '#7c3aed',
      avatarUrl: dbUser?.avatarUrl ?? null,
      isHost: false,
      isReady: false,
      score: 0,
    });
    attachSocketToRoom(socket, room, user.userId, false);
    void upsertPlayer(room, player).catch(() => undefined);
  }
  touchRoom(room);
  sendRoomState(socket, room);
  broadcastRoomUpdate(room);
}

async function joinAsSpectator(socket: AuthedSocket, room: LiveRoom, userId: string): Promise<boolean> {
  let spectator = getSpectatorEntry(room, userId);
  if (!spectator) {
    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    spectator = addPlayerToRoom(
      room,
      {
        userId,
        username: socket.data.user.username,
        avatarColor: dbUser?.avatarColor ?? '#7c3aed',
        avatarUrl: dbUser?.avatarUrl ?? null,
        isHost: false,
        isReady: false,
        score: 0,
      },
      { spectator: true },
    );
    void upsertPlayer(room, spectator).catch(() => undefined);
  }
  spectator.connected = true;
  if (spectator.reconnectTimer) {
    clearTimeout(spectator.reconnectTimer);
    spectator.reconnectTimer = null;
  }
  attachSocketToRoom(socket, room, userId, true);
  touchRoom(room);
  sendRoomState(socket, room);
  if (room.gameType && room.gameState !== null) {
    socket.emit('game:state', getPersonalSnapshot(room, userId));
  }
  broadcastRoomUpdate(room);
  return true;
}

async function handleRejoin(socket: AuthedSocket, payload: { roomId?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = typeof payload?.roomId === 'string' ? payload.roomId : '';
  const room = getRoomById(roomId);
  if (!room) {
    emitError(socket, 'room-not-found', 'Room not found.');
    return;
  }
  const player = getLivePlayer(room, user.userId);
  if (!player) {
    emitError(socket, 'not-in-room', 'You are not a member of this room.');
    return;
  }
  if (socket.data.roomId && socket.data.roomId !== room.id) {
    emitError(socket, 'already-in-room', 'You are already in a different room.');
    return;
  }
  attachSocketToRoom(socket, room, user.userId, player.isSpectator);
  touchRoom(room);
  sendRoomState(socket, room);
  if (room.gameType && room.gameState !== null) {
    sendGameState(socket, room);
  }
  broadcastRoomUpdate(room);
}

async function handleLeave(socket: AuthedSocket): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  socket.data.roomId = undefined;
  socket.data.isSpectator = undefined;
  if (!room) return;
  const wasHost = isHost(room, user.userId);
  removePlayerFromRoom(room, user.userId);
  removePlayerFromGameState(room, user.userId);
  leaveSocketRoom(socket, room);
  void deletePlayerRecord(user.userId, room.id).catch(() => undefined);
  if (room.players.size === 0 && room.spectators.size === 0) {
    clearTimers(room);
    deleteLiveRoom(room.id);
    void closeRoom(room).catch(() => undefined);
    socket.emit('room:left');
    return;
  }
  if (wasHost) transferHostIfNeeded(room);
  if (room.gameType && room.status === 'playing') {
    const def = getGame(room.gameType);
    if (def && room.players.size < def.minPlayers) {
      clearTimers(room);
      room.gameState = null;
      room.status = 'lobby';
      void setRoomStatus(room.id, 'lobby').catch(() => undefined);
    }
  }
  broadcastRoomUpdate(room);
  socket.emit('room:left');
}

async function handleReady(socket: AuthedSocket, payload: { ready?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  const player = getPlayerEntry(room, user.userId);
  if (!player) {
    emitError(socket, 'not-player', 'Spectators cannot ready up.');
    return;
  }
  if (room.status === 'playing') {
    emitError(socket, 'game-in-progress', 'Cannot change ready state during a game.');
    return;
  }
  player.isReady = payload?.ready === true;
  broadcastRoomUpdate(room);
  void setPlayerReady(user.userId, room.id, player.isReady).catch(() => undefined);
}

async function handleSelectGame(socket: AuthedSocket, payload: { gameType?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can select a game.');
    return;
  }
  if (room.status === 'playing') {
    emitError(socket, 'game-in-progress', 'Cannot change game while playing.');
    return;
  }
  const gameType = payload?.gameType === null ? null : typeof payload?.gameType === 'string' ? (payload.gameType as GameType) : null;
  if (gameType !== null && !getGame(gameType)) {
    emitError(socket, 'invalid-game', 'Unknown game.');
    return;
  }
  room.gameType = gameType;
  void setRoomGameType(room.id, gameType).catch(() => undefined);
  broadcastRoomUpdate(room);
}

async function handleStart(socket: AuthedSocket): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can start the game.');
    return;
  }
  if (room.status !== 'lobby') {
    emitError(socket, 'invalid-state', 'Game can only be started from the lobby.');
    return;
  }
  const def = getGame(room.gameType);
  if (!def) {
    emitError(socket, 'no-game-selected', 'Host must select a game first.');
    return;
  }
  if (!def.isPlayable(room)) {
    emitError(socket, 'not-enough-players', `Need at least ${def.minPlayers} players.`);
    return;
  }
  if (def.maxPlayers !== null && room.players.size > def.maxPlayers) {
    emitError(socket, 'too-many-players', 'Too many players for this game.');
    return;
  }
  const allReady = Array.from(room.players.values()).every((p) => p.isReady);
  if (!allReady) {
    emitError(socket, 'players-not-ready', 'All players must be ready before starting.');
    return;
  }
  clearTimers(room);
  room.status = 'playing';
  def.start(room);
  void setRoomStatus(room.id, 'playing').catch(() => undefined);
  broadcastRoomUpdate(room);
}

async function handleRestart(socket: AuthedSocket): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can restart the game.');
    return;
  }
  if (room.status !== 'finished') {
    emitError(socket, 'invalid-state', 'Game can only be restarted after it finishes.');
    return;
  }
  const def = getGame(room.gameType);
  if (!def) {
    emitError(socket, 'no-game-selected', 'No game selected.');
    return;
  }
  clearTimers(room);
  room.status = 'playing';
  def.restart(room);
  void setRoomStatus(room.id, 'playing').catch(() => undefined);
  broadcastRoomUpdate(room);
}

async function handleReturnToLobby(socket: AuthedSocket): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can return to the lobby.');
    return;
  }
  if (room.status !== 'finished') {
    emitError(socket, 'invalid-state', 'Only a finished game can return to the lobby.');
    return;
  }
  const def = getGame(room.gameType);
  if (def) def.stop(room);
  clearTimers(room);
  room.gameState = null;
  room.status = 'lobby';
  for (const player of room.players.values()) {
    player.isReady = false;
    player.score = 0;
  }
  void setRoomStatus(room.id, 'lobby').catch(() => undefined);
  emitToRoom(room, 'game:state', null);
  broadcastRoomUpdate(room);
}

async function handleSpectate(socket: AuthedSocket, payload: { spectating?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (room.status === 'playing') {
    emitError(socket, 'game-in-progress', 'You cannot toggle spectator during a game.');
    return;
  }
  const wantSpectate = payload?.spectating === true;
  const asPlayer = getPlayerEntry(room, user.userId);
  const asSpectator = getSpectatorEntry(room, user.userId);
  if (wantSpectate) {
    if (asSpectator) return;
    if (!asPlayer) return;
    if (isHost(room, user.userId) && room.players.size === 1) {
      emitError(socket, 'cannot-spectate', 'Host cannot spectate while alone in the room.');
      return;
    }
    room.players.delete(user.userId);
    asPlayer.isSpectator = true;
    asPlayer.isReady = false;
    room.spectators.set(user.userId, asPlayer);
    if (isHost(room, user.userId)) transferHostIfNeeded(room);
    void setPlayerSpectator(room.id, user.userId, true).catch(() => undefined);
    void setPlayerReady(user.userId, room.id, false).catch(() => undefined);
    socket.data.isSpectator = true;
  } else {
    if (asPlayer) return;
    if (!asSpectator) return;
    if (room.maxPlayers !== null && room.players.size >= room.maxPlayers) {
      emitError(socket, 'room-full', 'Room is full, cannot join as a player.');
      return;
    }
    room.spectators.delete(user.userId);
    asSpectator.isSpectator = false;
    room.players.set(user.userId, asSpectator);
    void setPlayerSpectator(room.id, user.userId, false).catch(() => undefined);
    socket.data.isSpectator = false;
  }
  broadcastRoomUpdate(room);
}

async function handleQuickPlay(socket: AuthedSocket): Promise<void> {
  const user = socket.data.user;
  if (socket.data.roomId) {
    emitError(socket, 'already-in-room', 'You are already in a room. Leave it first.');
    return;
  }
  const candidates = getAllRooms().filter((r) => {
    if (r.status !== 'lobby') return false;
    if (r.isPrivate) return false;
    if (!r.gameType) return false;
    const def = getGame(r.gameType);
    if (!def) return false;
    if (r.players.size < def.minPlayers) return false;
    if (r.maxPlayers !== null && r.players.size >= r.maxPlayers) return false;
    return true;
  });
  candidates.sort((a, b) => b.players.size - a.players.size);
  let room: LiveRoom;
  if (candidates.length > 0) {
    room = candidates[0];
  } else {
    const gameTypes: GameType[] = ['quiz', 'reaction', 'rps', 'draw', 'telephone', 'chameleon', 'reveal'];
    const gameType = gameTypes[Math.floor(Math.random() * gameTypes.length)];
    room = await createRoomForUser(
      { id: user.userId, username: user.username, avatarColor: '#7c3aed' },
      {
        name: `${user.username}'s quick play`,
        gameType,
        hostReady: true,
      },
    );
  }
  await handleJoin(socket, { code: room.code });
}

async function handleSettings(
  socket: AuthedSocket,
  payload: { password?: unknown; maxPlayers?: unknown; vibe?: unknown },
): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can change settings.');
    return;
  }
  if (room.status === 'playing') {
    emitError(socket, 'game-in-progress', 'Cannot change settings during a game.');
    return;
  }
  if (payload.password !== undefined) {
    if (typeof payload.password !== 'string' || payload.password.length > 64) {
      emitError(socket, 'invalid-password', 'Invalid password.');
      return;
    }
    const trimmed = payload.password.trim();
    if (trimmed === '') {
      room.isPrivate = false;
      room.passwordHash = null;
      void setRoomPassword(room.id, { isPrivate: false, passwordHash: null }).catch(() => undefined);
    } else {
      if (trimmed.length < 3) {
        emitError(socket, 'invalid-password', 'Password must be at least 3 characters.');
        return;
      }
      const hashed = await hashPassword(trimmed);
      room.isPrivate = true;
      room.passwordHash = hashed;
      void setRoomPassword(room.id, { isPrivate: true, passwordHash: hashed }).catch(() => undefined);
    }
  }
  if (payload.maxPlayers !== undefined) {
    const max = payload.maxPlayers;
    if (max === null) {
      room.maxPlayers = null;
      void setRoomMaxPlayers(room.id, null).catch(() => undefined);
    } else if (typeof max === 'number' && Number.isInteger(max) && max >= 2 && max <= 32) {
      room.maxPlayers = max;
      void setRoomMaxPlayers(room.id, max).catch(() => undefined);
    } else {
      emitError(socket, 'invalid-max-players', 'Invalid player limit.');
      return;
    }
  }
  if (payload.vibe !== undefined) {
    const vibe = payload.vibe;
    if (vibe === 'friends' || vibe === 'spice' || vibe === 'chaos' || vibe === 'mixed') {
      room.vibe = vibe as RoomVibe;
      void setRoomVibe(room.id, vibe as string).catch(() => undefined);
    } else {
      emitError(socket, 'invalid-vibe', 'Invalid room vibe.');
      return;
    }
  }
  broadcastRoomUpdate(room);
}

async function handleChat(socket: AuthedSocket, payload: { text?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (typeof payload?.text !== 'string') {
    emitError(socket, 'invalid-message', 'Invalid message.');
    return;
  }
  const text = censor(payload.text.trim());
  if (text.length < 1 || text.length > MAX_CHAT_LEN) {
    emitError(socket, 'invalid-message', 'Messages must be between 1 and 200 characters.');
    return;
  }
  const player = getLivePlayer(room, user.userId);
  if (player?.muted) {
    emitError(socket, 'muted', 'You are muted in this room.');
    return;
  }
  const message = {
    id: `${room.id}-${room.chat.length}-${Date.now()}`,
    roomId: room.id,
    userId: user.userId,
    username: currentPlayerUsername(room, user.userId),
    avatarColor: player?.avatarColor ?? '#7c3aed',
    avatarUrl: player?.avatarUrl ?? null,
    text,
    createdAt: new Date().toISOString(),
  };
  room.chat.push(message);
  if (room.chat.length > MAX_CHAT_HISTORY) {
    room.chat = room.chat.slice(-MAX_CHAT_HISTORY);
  }
  emitToRoom(room, 'chat:message', message);
  void persistChatMessage(room.id, { userId: user.userId, text }).catch(() => undefined);
}

async function handleReaction(socket: AuthedSocket, payload: { emoji?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (typeof payload?.emoji !== 'string' || !EMOJI_RE.test(payload.emoji) || payload.emoji.length > 8) {
    emitError(socket, 'invalid-emoji', 'Invalid emoji.');
    return;
  }
  const player = getLivePlayer(room, user.userId);
  if (player?.muted) {
    emitError(socket, 'muted', 'You are muted in this room.');
    return;
  }
  const reaction = {
    id: `${room.id}-${room.reactions.length}-${Date.now()}`,
    roomId: room.id,
    userId: user.userId,
    username: currentPlayerUsername(room, user.userId),
    avatarColor: player?.avatarColor ?? '#7c3aed',
    avatarUrl: player?.avatarUrl ?? null,
    emoji: payload.emoji,
    createdAt: new Date().toISOString(),
  };
  room.reactions.push(reaction);
  if (room.reactions.length > MAX_REACTIONS) {
    room.reactions = room.reactions.slice(-MAX_REACTIONS);
  }
  emitToRoom(room, 'reaction:new', reaction);
  void persistReaction(room.id, { userId: user.userId, emoji: payload.emoji }).catch(() => undefined);
}

async function handleKick(socket: AuthedSocket, payload: { userId?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can kick players.');
    return;
  }
  const targetId = typeof payload?.userId === 'string' ? payload.userId : '';
  if (!targetId || targetId === user.userId) {
    emitError(socket, 'invalid-target', 'Invalid kick target.');
    return;
  }
  const target = getLivePlayer(room, targetId);
  if (!target) {
    emitError(socket, 'invalid-target', 'That player is not in the room.');
    return;
  }
  removePlayerFromRoom(room, targetId);
  removePlayerFromGameState(room, targetId);
  void deletePlayerRecord(targetId, room.id).catch(() => undefined);
  emitToUser(targetId, 'room:kicked', { roomId: room.id, roomName: room.name });
  if (room.players.size === 0 && room.spectators.size === 0) {
    clearTimers(room);
    deleteLiveRoom(room.id);
    void closeRoom(room).catch(() => undefined);
    return;
  }
  if (target.isHost) transferHostIfNeeded(room);
  if (room.gameType && room.status === 'playing') {
    const def = getGame(room.gameType);
    if (def && room.players.size < def.minPlayers) {
      clearTimers(room);
      room.gameState = null;
      room.status = 'lobby';
      void setRoomStatus(room.id, 'lobby').catch(() => undefined);
    }
  }
  broadcastRoomUpdate(room);
}

async function handleMute(socket: AuthedSocket, payload: { userId?: unknown; muted?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (!isHost(room, user.userId)) {
    emitError(socket, 'not-host', 'Only the room host can mute players.');
    return;
  }
  const targetId = typeof payload?.userId === 'string' ? payload.userId : '';
  if (!targetId || targetId === user.userId) {
    emitError(socket, 'invalid-target', 'Invalid mute target.');
    return;
  }
  const target = getLivePlayer(room, targetId);
  if (!target) {
    emitError(socket, 'invalid-target', 'That player is not in the room.');
    return;
  }
  target.muted = payload?.muted === true;
  emitToUser(targetId, 'room:muted', { roomId: room.id, muted: target.muted });
  broadcastRoomUpdate(room);
}

async function handleInviteFriend(socket: AuthedSocket, payload: { userId?: unknown }): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  const targetId = typeof payload?.userId === 'string' ? payload.userId : '';
  if (!targetId || targetId === user.userId) {
    emitError(socket, 'invalid-target', 'Invalid invite target.');
    return;
  }
  if (room.status === 'finished') {
    emitError(socket, 'invalid-state', 'This room is not open for invites.');
    return;
  }
  const friend = await prisma.friend.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { userId: user.userId, friendId: targetId },
        { userId: targetId, friendId: user.userId },
      ],
    },
  });
  if (!friend) {
    emitError(socket, 'not-friends', 'You can only invite friends.');
    return;
  }
  const notif = await createNotification(targetId, 'room_invite', {
    roomId: room.id,
    roomName: room.name,
    code: room.code,
    gameType: room.gameType,
    fromName: user.username,
    fromId: user.userId,
  });
  emitToUser(targetId, 'notification:new', notif);
}

async function handleGameAction(socket: AuthedSocket, action: unknown): Promise<void> {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  if (room.status !== 'playing') {
    emitError(socket, 'not-playing', 'No game is in progress.');
    return;
  }
  const def = getGame(room.gameType);
  if (!def || room.gameState === null) {
    emitError(socket, 'no-game', 'No active game.');
    return;
  }
  if (typeof action !== 'object' || action === null || typeof (action as { type?: unknown }).type !== 'string') {
    emitError(socket, 'invalid-action', 'Malformed game action.');
    return;
  }
  const result = def.handleAction(room, user.userId, action as { type: string; payload?: unknown });
  if (!result.ok) {
    emitError(socket, result.error ?? 'invalid-action', 'Action rejected by server.');
  }
}

export function handleSocketDisconnect(socket: AuthedSocket): void {
  const user = socket.data.user;
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = getRoomById(roomId);
  if (!room) return;
  detachSocketFromRoom(socket, room, user.userId);
  const player = getLivePlayer(room, user.userId);
  if (!player) return;
  if (player.socketIds.size > 0) return;
  broadcastRoomUpdate(room);
  setReconnectTimer(room, user.userId, config.reconnectGraceMs, () => {
    if (player.socketIds.size > 0) return;
    const current = getLivePlayer(room, user.userId);
    if (!current) return;
    const wasHost = isHost(room, user.userId);
    removePlayerFromRoom(room, user.userId);
    removePlayerFromGameState(room, user.userId);
    void deletePlayerRecord(user.userId, room.id).catch(() => undefined);
    if (room.players.size === 0 && room.spectators.size === 0) {
      clearTimers(room);
      deleteLiveRoom(room.id);
      void closeRoom(room).catch(() => undefined);
      return;
    }
    if (wasHost) transferHostIfNeeded(room);
    if (room.gameType && room.status === 'playing') {
      const def = getGame(room.gameType);
      if (def && room.players.size < def.minPlayers) {
        clearTimers(room);
        room.gameState = null;
        room.status = 'lobby';
        void setRoomStatus(room.id, 'lobby').catch(() => undefined);
      }
    }
    broadcastRoomUpdate(room);
  });
}

export function onConnection(socket: AuthedSocket): void {
  joinSocketToUserRoom(socket, socket.data.user.userId);
  registerRoomHandlers(socket);
  socket.on('disconnect', () => handleSocketDisconnect(socket));
}
