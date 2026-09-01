import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createContext } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TECA_DATA_DIR ?? path.resolve(here, '../../data');
const port = Number(process.env.PORT ?? 5174);

const ctx = createContext({ dataDir });
const app = createApp(ctx, { staticDir: path.resolve(here, '../../web/dist') });

const server = app.listen(port, () => {
  console.log(`teca server → http://localhost:${port}  (data: ${dataDir})`);
});

const shutdown = async () => {
  server.close();
  await ctx.flush();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
