import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { gameMetaList } from '../games/registry';

const router = Router();

router.get('/', requireAuth, (_req, res) => {
  res.json({ games: gameMetaList() });
});

export default router;
