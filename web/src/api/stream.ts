import type { AgentEvent, Attachment } from '@teca/shared';

export interface RunRequest {
  boardId: string;
  text: string;
  model?: string;
  attachments?: Attachment[];
}

/**
 * Posts a chat turn and consumes the server-sent event stream it returns.
 * The returned function aborts the run.
 */
export const runAgent = (
  input: RunRequest,
  onEvent: (event: AgentEvent) => void,
): { done: Promise<void>; abort: () => void } => {
  const controller = new AbortController();

  const done = (async () => {
    const response = await fetch(`/api/boards/${input.boardId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        model: input.model,
        attachments: input.attachments,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      let message = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* keep status message */
      }
      onEvent({ type: 'error', message });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
        } catch {
          /* ignore malformed frames */
        }
      }
    }
  })().catch((error: unknown) => {
    if (controller.signal.aborted) return;
    onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });

  return { done, abort: () => controller.abort() };
};
