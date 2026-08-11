import type { Request } from 'express';
import { config } from '../config';

export function clientUrl(req: Request, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (config.nodeEnv === 'production') {
    const isLocalOrigin = /localhost|127\.0\.0\.1/.test(config.clientOrigin);
    if (!isLocalOrigin) {
      return `${config.clientOrigin.replace(/\/$/, '')}${suffix}`;
    }
    const host = req.get('host') ?? config.clientOrigin.replace(/^https?:\/\//, '');
    const forwarded = req.headers['x-forwarded-proto'];
    const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ?? req.protocol;
    return `${proto}://${host}${suffix}`;
  }
  return `${config.clientOrigin.replace(/\/$/, '')}${suffix}`;
}
