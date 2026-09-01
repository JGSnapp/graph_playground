import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../http/async-handler.js';
import { DEFAULT_SYSTEM_PROMPT } from './defaults.js';

const patchSchema = z.object({
  provider: z
    .object({
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      defaultModel: z.string().optional(),
      embeddingModel: z.string().optional(),
    })
    .optional(),
  agent: z
    .object({
      systemPrompt: z.string().optional(),
      maxIterations: z.number().int().min(1).max(200).optional(),
      unlimitedIterations: z.boolean().optional(),
      providerRetries: z.number().int().min(0).max(10).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(256).max(32_768).optional(),
    })
    .optional(),
  knowledge: z
    .object({
      readEnabled: z.boolean().optional(),
      writeEnabled: z.boolean().optional(),
      topK: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  skills: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
});

export const settingsRoutes = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/settings', (_req, res) => {
    res.json(ctx.settings.getPublic());
  });

  router.patch('/settings', (req, res) => {
    const patch = patchSchema.parse(req.body);
    res.json(ctx.settings.update(patch));
  });

  router.get('/settings/default-prompt', (_req, res) => {
    res.json({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
  });

  router.get(
    '/models',
    asyncHandler(async (req, res) => {
      const { models, source } = await ctx.provider.listModels(req.query.refresh === '1');
      res.json({ models, source });
    }),
  );

  router.get(
    '/debug/llm',
    asyncHandler(async (req, res) => {
      const model =
        typeof req.query.model === 'string' && req.query.model
          ? req.query.model
          : ctx.settings.get().provider.defaultModel;
      res.json(await ctx.provider.probe(model));
    }),
  );

  return router;
};
