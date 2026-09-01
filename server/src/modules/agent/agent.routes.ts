import type { AgentEvent } from '@teca/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../../http/async-handler.js';

const attachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'file']),
  name: z.string(),
  mime: z.string(),
  dataUrl: z.string().optional(),
  text: z.string().optional(),
  size: z.number().optional(),
});

export const agentRoutes = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/boards/:id/messages', (req, res) => {
    res.json({ messages: ctx.chats.list(req.params.id) });
  });

  router.get('/boards/:id/runs', (req, res) => {
    ctx.boards.get(req.params.id);
    res.json({ runs: ctx.runLogs.list(req.params.id) });
  });

  router.get('/runs/:runId', (req, res) => {
    res.json({ run: ctx.runLogs.get(req.params.runId) });
  });

  router.delete('/boards/:id/messages', (req, res) => {
    ctx.chats.clear(req.params.id);
    res.status(204).end();
  });

  router.post(
    '/boards/:id/chat',
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          text: z.string(),
          model: z.string().optional(),
          attachments: z.array(attachmentSchema).optional(),
        })
        .parse(req.body);

      // Fail before switching to SSE so the client can show a normal error.
      ctx.boards.get(req.params.id);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      const emit = (event: AgentEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Abort only when the client drops mid-stream. `close` also fires after a
      // normal `res.end()`, so ignore that case via writableFinished.
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });

      await ctx.agent.run(
        {
          boardId: req.params.id,
          text: body.text,
          model: body.model,
          attachments: body.attachments,
        },
        emit,
        controller.signal,
      );
      if (!res.writableEnded) res.end();
    }),
  );

  router.post('/screenshots/:requestId', (req, res) => {
    const body = z.object({ dataUrl: z.string().nullable() }).parse(req.body);
    const accepted = ctx.screenshots.fulfill(req.params.requestId, body.dataUrl);
    res.json({ accepted });
  });

  return router;
};
