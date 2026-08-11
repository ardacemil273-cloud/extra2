import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { config } from './config';
import authRoutes from './routes/auth';
import roomRoutes from './routes/rooms';
import gameRoutes from './routes/games';
import socialRoutes from './routes/social';
import uploadRoutes from './routes/uploads';
import shareRoutes from './routes/share';

export function createApp(): express.Express {
  const app = express();
  app.use(
    cors({
      origin: (origin, cb) => {
        if (config.nodeEnv === 'production') {
          if (!origin) {
            cb(null, false);
            return;
          }
          cb(null, origin);
          return;
        }
        cb(null, config.clientOrigin);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'partyverse-backend', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/games', gameRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/ads', uploadRoutes);
  app.use('/api/me', uploadRoutes);
  app.use(shareRoutes);

  const distCandidates = [
    path.resolve(process.cwd(), '..', 'frontend', 'dist'),
    path.resolve(process.cwd(), 'frontend', 'dist'),
  ];
  const frontendDist = distCandidates.find((dir) => fs.existsSync(dir));
  if (frontendDist) {
    app.use(express.static(frontendDist));
    app.get(/^\/(?!api\/|share\/|uploads\/|socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'not-found', message: 'Route not found.' });
  });

  return app;
}
