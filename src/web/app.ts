import { Hono, type MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import type { MailTransport } from '../email/transport.ts';
import type { DeliveryNoteSource } from '../onix/source.ts';
import { authMiddleware, authRoutes } from './auth.ts';
import { adminRoutes } from './routes/admin.ts';
import { emailRoutes } from './routes/email.ts';
import { comparisonRoutes } from './routes/comparison.ts';
import { indexWeightsRoutes } from './routes/index-weights.ts';
import { reportRoutes } from './routes/report.ts';
import { correctionRoutes } from './routes/corrections.ts';
import { stationRoutes } from './routes/station.ts';

export interface AppDeps {
  db: Db;
  config: Config;
  source: DeliveryNoteSource | null;
  now: () => number;
  /** Mail transport for the test e-mail; SMTP from the configuration when absent. */
  mail?: MailTransport;
  logError: (message: string, error: unknown) => void;
}

export type AppEnv = { Variables: { manager: string | null } };

/**
 * Refuses a state-changing request that a browser marks as coming from another site: an `Origin` that is not our own origin
 * (`null` included), or `Sec-Fetch-Site: cross-site`. Requests without these headers (scanner scripts, curl, tests) pass.
 */
export const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if ((origin !== undefined && origin !== new URL(c.req.url).origin) || c.req.header('sec-fetch-site') === 'cross-site') {
      return c.text('Požiadavka z inej stránky sa nevykoná.', 403);
    }
  }
  await next();
};

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', sameOriginOnly);
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
  app.route('/', reportRoutes(deps));
  app.route('/', correctionRoutes(deps));
  app.route('/', emailRoutes(deps));
  app.route('/', comparisonRoutes(deps));
  app.route('/', indexWeightsRoutes(deps));
  app.onError((err, c) => {
    deps.logError(`${c.req.method} ${c.req.path}`, err);
    return c.text('Nastala chyba. Skúste to znova; ak pretrváva, kontaktujte správcu.', 500);
  });
  return app;
}
