import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { DeliveryNoteSource } from '../onix/source.ts';
import { authMiddleware, authRoutes } from './auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { correctionRoutes } from './routes/corrections.ts';
import { stationRoutes } from './routes/station.ts';

export interface AppDeps {
  db: Db;
  config: Config;
  source: DeliveryNoteSource | null;
  now: () => number;
  logError: (message: string, error: unknown) => void;
}

export type AppEnv = { Variables: { manager: string | null } };

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware(deps));
  app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));
  app.get('/health', (c) => {
    try {
      deps.db.prepare('SELECT 1').get();
      return c.json({ ok: true });
    } catch (e) {
      deps.logError('health check failed', e);
      return c.json({ ok: false }, 503);
    }
  });
  app.route('/', authRoutes(deps));
  app.route('/', stationRoutes(deps));
  app.route('/', adminRoutes(deps));
  app.route('/', correctionRoutes(deps));
  app.onError((err, c) => {
    deps.logError(`${c.req.method} ${c.req.path}`, err);
    return c.text('Nastala chyba. Skúste to znova; ak pretrváva, kontaktujte správcu.', 500);
  });
  return app;
}
