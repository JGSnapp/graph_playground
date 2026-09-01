import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, type AppContext } from '../src/context.js';

export interface TestEnv {
  ctx: AppContext;
  dir: string;
  dispose: () => Promise<void>;
}

export const makeEnv = (options: { fetchImpl?: typeof fetch; screenshotTimeoutMs?: number } = {}): TestEnv => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teca-test-'));
  const ctx = createContext({ dataDir: dir, ...options });
  return {
    ctx,
    dir,
    dispose: async () => {
      await ctx.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** Builds a fetch Response carrying an OpenAI-style SSE completion stream. */
export const sseResponse = (frames: unknown[]): Response => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

export const contentFrame = (content: string) => ({ choices: [{ delta: { content } }] });

export const toolCallFrame = (index: number, id: string, name: string, args: string) => ({
  choices: [
    {
      delta: {
        tool_calls: [{ index, id, function: { name, arguments: args } }],
      },
    },
  ],
});

export const finishFrame = (reason: string) => ({ choices: [{ delta: {}, finish_reason: reason }] });
