import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';

export const skillsRoutes = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/skills', (_req, res) => {
    res.json({ skills: ctx.skills.list() });
  });

  router.post('/skills', (req, res) => {
    const body = z
      .object({
        slug: z.string().optional(),
        name: z.string().min(1),
        when: z.string().min(1),
        body: z.string().min(1),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(ctx.skills.add(body));
  });

  router.patch('/skills/:id', (req, res) => {
    const body = z
      .object({
        slug: z.string().optional(),
        name: z.string().min(1).optional(),
        when: z.string().min(1).optional(),
        body: z.string().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    res.json(ctx.skills.update(req.params.id, body));
  });

  router.delete('/skills/:id', (req, res) => {
    ctx.skills.remove(req.params.id);
    res.status(204).end();
  });

  router.post('/skills/restore', (_req, res) => {
    res.json({ skills: ctx.skills.restoreBuiltins() });
  });

  return router;
};
