import { ARTIFACT_TYPES, type ArtifactType } from '@teca/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  addBend,
  bringToFront,
  createArrow,
  createArtifact,
  deleteArrow,
  deleteArtifact,
  moveBend,
  removeBend,
  updateArrow,
  updateArtifact,
} from './operations.js';

const point = z.object({ x: z.number(), y: z.number() });
const side = z.enum(['top', 'right', 'bottom', 'left', 'auto']);
const style = z
  .object({
    color: z.string().optional(),
    dashed: z.boolean().optional(),
    width: z.number().optional(),
    bidirectional: z.boolean().optional(),
  })
  .optional();

export const boardsRoutes = (ctx: AppContext): Router => {
  const router = Router();

  router.get('/boards', (_req, res) => {
    res.json({ boards: ctx.boards.listBoards(), summaries: ctx.boards.list() });
  });

  router.post('/boards', (req, res) => {
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        model: z.string().optional(),
      })
      .parse(req.body ?? {});
    res.status(201).json(ctx.boards.create(body));
  });

  router.get('/boards/:id', (req, res) => {
    res.json({ board: ctx.boards.get(req.params.id), history: ctx.boards.history(req.params.id) });
  });

  router.patch('/boards/:id', (req, res) => {
    const body = z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        model: z.string().optional(),
        viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
      })
      .parse(req.body ?? {});
    res.json(ctx.boards.updateMeta(req.params.id, body));
  });

  router.delete('/boards/:id', (req, res) => {
    ctx.boards.remove(req.params.id);
    ctx.chats.removeForBoard(req.params.id);
    ctx.runLogs.removeForBoard(req.params.id);
    res.status(204).end();
  });

  router.post('/boards/:id/undo', (req, res) => {
    res.json({ board: ctx.boards.undo(req.params.id), history: ctx.boards.history(req.params.id) });
  });

  router.post('/boards/:id/redo', (req, res) => {
    res.json({ board: ctx.boards.redo(req.params.id), history: ctx.boards.history(req.params.id) });
  });

  router.post('/boards/:id/artifacts', (req, res) => {
    const body = z
      .object({
        type: z.enum(ARTIFACT_TYPES as [ArtifactType, ...ArtifactType[]]),
        x: z.number(),
        y: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        props: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    res.status(201).json(ctx.boards.mutate(req.params.id, (state) => createArtifact(state, body)));
  });

  router.patch('/boards/:id/artifacts/:artifactId', (req, res) => {
    const body = z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        rotation: z.number().optional(),
        props: z.record(z.unknown()).optional(),
        replaceProps: z.boolean().optional(),
        toFront: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const result = ctx.boards.mutate(req.params.id, (state) => {
      if (body.toFront) bringToFront(state, req.params.artifactId);
      return updateArtifact(state, req.params.artifactId, body);
    });
    res.json(result.artifact);
  });

  router.delete('/boards/:id/artifacts/:artifactId', (req, res) => {
    ctx.boards.mutate(req.params.id, (state) => deleteArtifact(state, req.params.artifactId));
    res.status(204).end();
  });

  router.post('/boards/:id/arrows', (req, res) => {
    const body = z
      .object({
        fromId: z.string(),
        toId: z.string(),
        fromSide: side.optional(),
        toSide: side.optional(),
        bends: z.array(point).optional(),
        label: z.string().optional(),
        style,
      })
      .parse(req.body);
    res.status(201).json(ctx.boards.mutate(req.params.id, (state) => createArrow(state, body)));
  });

  router.patch('/boards/:id/arrows/:arrowId', (req, res) => {
    const body = z
      .object({
        fromSide: side.optional(),
        toSide: side.optional(),
        label: z.string().optional(),
        style,
        bends: z.array(point).optional(),
      })
      .parse(req.body ?? {});
    res.json(ctx.boards.mutate(req.params.id, (state) => updateArrow(state, req.params.arrowId, body)));
  });

  router.post('/boards/:id/arrows/:arrowId/bends', (req, res) => {
    const body = z.object({ x: z.number(), y: z.number(), index: z.number().optional() }).parse(req.body);
    res.json(
      ctx.boards.mutate(req.params.id, (state) =>
        addBend(state, req.params.arrowId, { x: body.x, y: body.y }, body.index),
      ),
    );
  });

  router.patch('/boards/:id/arrows/:arrowId/bends/:index', (req, res) => {
    const body = z.object({ x: z.number(), y: z.number() }).parse(req.body);
    res.json(
      ctx.boards.mutate(req.params.id, (state) =>
        moveBend(state, req.params.arrowId, Number(req.params.index), body),
      ),
    );
  });

  router.delete('/boards/:id/arrows/:arrowId/bends/:index', (req, res) => {
    res.json(
      ctx.boards.mutate(req.params.id, (state) =>
        removeBend(state, req.params.arrowId, Number(req.params.index)),
      ),
    );
  });

  router.delete('/boards/:id/arrows/:arrowId', (req, res) => {
    ctx.boards.mutate(req.params.id, (state) => deleteArrow(state, req.params.arrowId));
    res.status(204).end();
  });

  return router;
};
