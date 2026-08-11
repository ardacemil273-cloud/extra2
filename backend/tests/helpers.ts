import request from 'supertest';
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client';
import { createGameServer, listen, type GameServer } from '../src/server';
import type { RoomState } from '../src/types';

export interface TestEnv {
  server: GameServer['server'];
  io: GameServer['io'];
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function startTestEnv(): Promise<TestEnv> {
  const { server, io } = createGameServer();
  const port = await listen(server, 0);
  const baseUrl = `http://localhost:${port}`;
  return {
    server,
    io,
    baseUrl,
    cleanup: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function registerUser(
  baseUrl: string,
  username: string,
): Promise<{ token: string; user: { id: string; username: string; email: string; avatarColor: string } }> {
  const res = await request(baseUrl)
    .post('/api/auth/register')
    .send({ username, email: `${username}@test.partyverse`, password: 'password123' });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { token: string; user: { id: string; username: string; email: string; avatarColor: string } };
}

export async function createRoom(
  baseUrl: string,
  token: string,
  name?: string,
): Promise<RoomState> {
  const res = await request(baseUrl)
    .post('/api/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send(name ? { name } : {});
  if (res.status !== 201) {
    throw new Error(`create room failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.room as RoomState;
}

export interface WaitResult<T> {
  event: string;
  payload: T;
}

export class TestSocket {
  socket: ClientSocket;
  roomState: RoomState | null = null;
  gameState: unknown = null;
  errors: { code: string; message: string }[] = [];
  private listeners: Array<{ event: string; resolve: (payload: unknown) => void; predicate: (p: unknown) => boolean }> = [];

  constructor(url: string, token: string) {
    this.socket = createSocketClient(url, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token },
      reconnection: false,
    });
    this.socket.on('room:state', (payload: RoomState) => {
      this.roomState = payload;
      this.satisfy('room:state', payload);
    });
    this.socket.on('room:update', (payload: RoomState) => {
      this.roomState = payload;
      this.satisfy('room:update', payload);
    });
    this.socket.on('game:state', (payload: unknown) => {
      this.gameState = payload;
      this.satisfy('game:state', payload);
    });
    this.socket.on('game:stroke', (payload: unknown) => {
      this.satisfy('game:stroke', payload);
    });
    this.socket.on('game:clear', (payload: unknown) => {
      this.satisfy('game:clear', payload);
    });
    this.socket.on('game:revealGuess', (payload: unknown) => {
      this.satisfy('game:revealGuess', payload);
    });
    this.socket.on('game:finished', (payload: unknown) => {
      this.satisfy('game:finished', payload);
    });
    this.socket.on('error', (payload: { code: string; message: string }) => {
      this.errors.push(payload);
      this.satisfy('error', payload);
    });
    this.socket.on('room:left', () => {
      this.satisfy('room:left', null);
    });
    this.socket.on('room:kicked', (payload: unknown) => {
      this.satisfy('room:kicked', payload);
    });
    this.socket.on('room:muted', (payload: unknown) => {
      this.satisfy('room:muted', payload);
    });
    this.socket.on('notification:new', (payload: unknown) => {
      this.satisfy('notification:new', payload);
    });
    this.socket.on('connect_error', () => {
      // leave unhandled; connect() surfaces errors explicitly
    });
  }

  private satisfy(event: string, payload: unknown): void {
    this.listeners = this.listeners.filter((l) => {
      if (l.event === event && l.predicate(payload)) {
        l.resolve(payload);
        return false;
      }
      return true;
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  waitFor<T>(event: string, predicate: (payload: unknown) => boolean, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => !(l.event === event));
        reject(new Error(`timeout waiting for ${event}`));
      }, timeoutMs);
      const entry = {
        event,
        predicate,
        resolve: (payload: unknown) => {
          clearTimeout(timer);
          resolve(payload as T);
        },
      };
      this.listeners.push(entry);
    });
  }

  emit(event: string, payload?: unknown): void {
    this.socket.emit(event, payload);
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.removeAllListeners();
      this.socket.close();
      resolve();
    });
  }

  player(userId: string) {
    return this.roomState?.players.find((p) => p.userId === userId) ?? null;
  }
}
