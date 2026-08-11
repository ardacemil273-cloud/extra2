import type { Request } from 'express';
import { config } from '../config';

export function clientUrl(req: Request, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (config.nodeEnv === 'production') {
    const host = req.get('host') ?? config.clientOrigin.replace(/^https?:\/\//, '');
    const proto = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() ?? req.protocol;
    return `${proto}://${host}${suffix}`;
  }
  return `${config.clientOrigin.replace(/\/$/, '')}${suffix}`;
}
