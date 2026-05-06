import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT) || 3071;
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`usdc-widget on http://localhost:${port}`);
});
