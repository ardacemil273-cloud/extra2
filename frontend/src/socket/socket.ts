import { io, type Socket } from 'socket.io-client';
import type {
  AnyGameState,
  ChatMessagePublic,
  DrawStroke,
  GameAward,
  GamePlayerResult,
  NotificationInfo,
  ReactionPublic,
  RoomState,
  SocketError,
} from '../types';

export type RealtimeEvent =
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'connect_error' }
  | { type: 'room'; payload: RoomState | null }
  | { type: 'game'; payload: AnyGameState | null }
  | { type: 'chat'; payload: ChatMessagePublic }
  | { type: 'reaction'; payload: ReactionPublic }
  | { type: 'stroke'; payload: DrawStroke }
  | { type: 'clear'; payload: { from: string } }
  | { type: 'revealGuess'; payload: { userId: string; points: number } }
  | { type: 'finished'; payload: { results: GamePlayerResult[]; awards: GameAward[]; roomId: string; historyId?: string } }
  | { type: 'kicked'; payload: { roomId: string; roomName: string } }
  | { type: 'muted'; payload: { roomId: string; muted: boolean } }
  | { type: 'notification'; payload: NotificationInfo }
  | { type: 'error'; payload: SocketError };

type Listener = (event: RealtimeEvent) => void;

export interface JoinRoomOptions {
  code: string;
  password?: string;
  spectate?: boolean;
}

export interface PartySocket {
  get connected(): boolean;
  connect(token: string): void;
  on(listener: Listener): () => void;
  joinRoom(code: string, password?: string, spectate?: boolean): void;
  rejoinRoom(roomId: string): void;
  leaveRoom(): void;
  setReady(ready: boolean): void;
  selectGame(gameType: string | null): void;
  startGame(): void;
  restartGame(): void;
  returnToLobby(): void;
  spectate(spectating: boolean): void;
  quickPlay(): void;
  updateSettings(settings: { password?: string; maxPlayers?: number | null; vibe?: string }): void;
  setVibe(vibe: string): void;
  sendChat(text: string): void;
  sendReaction(emoji: string): void;
  sendGameAction(action: { type: string; payload?: unknown }): void;
  kickPlayer(userId: string): void;
  mutePlayer(userId: string, muted: boolean): void;
  inviteFriend(userId: string): void;
  dispose(): void;
}

class PartySocketImpl implements PartySocket {
  private socket: Socket | null = null;
  private listeners = new Set<Listener>();

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  connect(token: string): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket.removeAllListeners();
    }
    this.socket = io({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 15000,
      transports: ['polling'],
      auth: { token },
    });

    this.socket.on('connect', () => this.emit({ type: 'connect' }));
    this.socket.on('disconnect', () => this.emit({ type: 'disconnect' }));
    this.socket.on('connect_error', () => this.emit({ type: 'connect_error' }));
    this.socket.on('room:state', (payload: RoomState) => this.emit({ type: 'room', payload }));
    this.socket.on('room:update', (payload: RoomState) => this.emit({ type: 'room', payload }));
    this.socket.on('game:state', (payload: AnyGameState | null) =>
      this.emit({ type: 'game', payload }),
    );
    this.socket.on('chat:message', (payload: ChatMessagePublic) =>
      this.emit({ type: 'chat', payload }),
    );
    this.socket.on('reaction:new', (payload: ReactionPublic) =>
      this.emit({ type: 'reaction', payload }),
    );
    this.socket.on('game:stroke', (payload: DrawStroke) => this.emit({ type: 'stroke', payload }));
    this.socket.on('game:clear', (payload: { from: string }) => this.emit({ type: 'clear', payload }));
    this.socket.on('game:revealGuess', (payload: { userId: string; points: number }) =>
      this.emit({ type: 'revealGuess', payload }),
    );
    this.socket.on('game:finished', (payload: { results: GamePlayerResult[]; awards: GameAward[]; roomId: string; historyId?: string }) =>
      this.emit({ type: 'finished', payload }),
    );
    this.socket.on('room:left', () => this.emit({ type: 'room', payload: null }));
    this.socket.on('room:kicked', (payload: { roomId: string; roomName: string }) =>
      this.emit({ type: 'kicked', payload }),
    );
    this.socket.on('room:muted', (payload: { roomId: string; muted: boolean }) =>
      this.emit({ type: 'muted', payload }),
    );
    this.socket.on('notification:new', (payload: NotificationInfo) =>
      this.emit({ type: 'notification', payload }),
    );
    this.socket.on('error', (payload: SocketError) => this.emit({ type: 'error', payload }));
  }

  private emit(event: RealtimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  joinRoom(code: string, password?: string, spectate?: boolean): void {
    this.socket?.emit('room:join', { code, password, spectate });
  }

  rejoinRoom(roomId: string): void {
    this.socket?.emit('room:rejoin', { roomId });
  }

  leaveRoom(): void {
    this.socket?.emit('room:leave');
  }

  setReady(ready: boolean): void {
    this.socket?.emit('room:ready', { ready });
  }

  selectGame(gameType: string | null): void {
    this.socket?.emit('room:selectGame', { gameType });
  }

  startGame(): void {
    this.socket?.emit('room:start');
  }

  restartGame(): void {
    this.socket?.emit('room:restart');
  }

  returnToLobby(): void {
    this.socket?.emit('room:returnToLobby');
  }

  spectate(spectating: boolean): void {
    this.socket?.emit('room:spectate', { spectating });
  }

  quickPlay(): void {
    this.socket?.emit('room:quickPlay');
  }

  updateSettings(settings: { password?: string; maxPlayers?: number | null; vibe?: string }): void {
    this.socket?.emit('room:settings', settings);
  }

  setVibe(vibe: string): void {
    this.socket?.emit('room:settings', { vibe });
  }

  sendChat(text: string): void {
    this.socket?.emit('room:chat', { text });
  }

  sendReaction(emoji: string): void {
    this.socket?.emit('room:react', { emoji });
  }

  sendGameAction(action: { type: string; payload?: unknown }): void {
    this.socket?.emit('game:action', action);
  }

  kickPlayer(userId: string): void {
    this.socket?.emit('room:kick', { userId });
  }

  mutePlayer(userId: string, muted: boolean): void {
    this.socket?.emit('room:mute', { userId, muted });
  }

  inviteFriend(userId: string): void {
    this.socket?.emit('room:inviteFriend', { userId });
  }

  dispose(): void {
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = null;
    this.listeners.clear();
  }
}

export function createPartySocket(): PartySocket {
  return new PartySocketImpl();
}
