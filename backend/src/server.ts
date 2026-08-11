import http from 'http';
import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { createApp } from './app';
import { config } from './config';
import { verifyToken } from './utils/jwt';
import { setIo } from './socket/store';
import { onConnection } from './socket/handlers';
import type { AuthedSocket } from './types';

export interface GameServer {
  server: HttpServer;
  io: Server;
}

export function createGameServer(): GameServer {
  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: config.nodeEnv === 'production' ? true : config.clientOrigin,
      credentials: true,
    },
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  setIo(io);

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.user = {
      userId: payload.sub,
      username: payload.username,
    };
    next();
  });

  io.on('connection', (socket) => {
    onConnection(socket as AuthedSocket);
  });

  return { server, io };
}

export function listen(server: HttpServer, port = 0): Promise<number> {
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve(actualPort);
    });
  });
}
