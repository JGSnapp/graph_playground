import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../http/async-handler.js';

export const knowledgeRoutes = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/knowledge', (_req, res) => {
    res.json({ entries: ctx.knowledge.list(), stats: ctx.knowledge.stats() });
  });

  router.post(
    '/knowledge',
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().min(1),
          text: z.string().min(1),
          tags: z.array(z.string()).optional(),
        })
        .parse(req.body);
      res.status(201).json(await ctx.knowledge.add({ ...body, source: 'user' }));
    }),
  );

  router.patch(
    '/knowledge/:id',
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          title: z.string().optional(),
          text: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .parse(req.body ?? {});
      res.json(await ctx.knowledge.update(req.params.id, body));
    }),
  );

  router.delete('/knowledge/:id', (req, res) => {
    ctx.knowledge.remove(req.params.id);
    res.status(204).end();
  });

  router.post(
    '/knowledge/search',
    asyncHandler(async (req, res) => {
      const body = z
        .object({ query: z.string(), k: z.number().int().min(1).max(50).optional() })
        .parse(req.body);
      const hits = await ctx.knowledge.search(body.query, body.k ?? ctx.settings.get().knowledge.topK);
      res.json({ hits, stats: ctx.knowledge.stats() });
    }),
  );

  router.post(
    '/knowledge/reindex',
    asyncHandler(async (_req, res) => {
      await ctx.knowledge.reindex(true);
      res.json({ stats: ctx.knowledge.stats() });
    }),
  );

  return router;
};
