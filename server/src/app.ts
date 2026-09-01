import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { HttpError } from './core/errors.js';
import { agentRoutes } from './modules/agent/agent.routes.js';
import { boardsRoutes } from './modules/boards/boards.routes.js';
import { knowledgeRoutes } from './modules/knowledge/knowledge.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { skillsRoutes } from './modules/skills/skills.routes.js';

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: error.issues });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }
  const message = error instanceof Error ? error.message : 'Internal error';
  if (!res.headersSent) res.status(500).json({ error: message });
  else res.end();
};

export interface AppOptions {
  /** Serves the production bundle when present, so `npm start` is self-contained. */
  staticDir?: string;
}

export const createApp = (ctx: AppContext, options: AppOptions = {}) => {
  const app = express();
  app.use(cors());
  // Images are inlined as data URLs, so the body limit is generous.
  app.use(express.json({ limit: '32mb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true, providerConfigured: ctx.provider.configured });
  });
  api.use(settingsRoutes(ctx));
  api.use(boardsRoutes(ctx));
  api.use(knowledgeRoutes(ctx));
  api.use(skillsRoutes(ctx));
  api.use(agentRoutes(ctx));

  app.use('/api', api);

  if (options.staticDir && fs.existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
};
