import type {
  Arrow,
  Artifact,
  ArtifactType,
  Board,
  BoardSummary,
  ChatMessage,
  KnowledgeEntry,
  KnowledgeHit,
  KnowledgeStats,
  ModelInfo,
  PublicSettings,
  Skill,
  Vec2,
  Viewport,
} from '@teca/shared';

const API = '/api';

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the status-based message */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  health: () => request<{ ok: boolean; providerConfigured: boolean }>('/health'),

  getSettings: () => request<PublicSettings>('/settings'),
  updateSettings: (patch: unknown) =>
    request<PublicSettings>('/settings', { method: 'PATCH', ...json(patch) }),
  defaultPrompt: () => request<{ systemPrompt: string }>('/settings/default-prompt'),
  models: (refresh = false) =>
    request<{ models: ModelInfo[]; source: 'api' | 'fallback' }>(
      `/models${refresh ? '?refresh=1' : ''}`,
    ),

  listBoards: () => request<{ boards: Board[]; summaries: BoardSummary[] }>('/boards'),
  createBoard: (input: { title?: string; model?: string } = {}) =>
    request<Board>('/boards', { method: 'POST', ...json(input) }),
  getBoard: (id: string) =>
    request<{ board: Board; history: { canUndo: boolean; canRedo: boolean } }>(`/boards/${id}`),
  patchBoard: (
    id: string,
    patch: { title?: string; description?: string; model?: string; viewport?: Viewport },
  ) => request<Board>(`/boards/${id}`, { method: 'PATCH', ...json(patch) }),
  deleteBoard: (id: string) => request<void>(`/boards/${id}`, { method: 'DELETE' }),
  undo: (id: string) =>
    request<{ board: Board; history: { canUndo: boolean; canRedo: boolean } }>(
      `/boards/${id}/undo`,
      { method: 'POST' },
    ),
  redo: (id: string) =>
    request<{ board: Board; history: { canUndo: boolean; canRedo: boolean } }>(
      `/boards/${id}/redo`,
      { method: 'POST' },
    ),

  createArtifact: (
    boardId: string,
    input: { type: ArtifactType; x: number; y: number; width?: number; height?: number; props?: Record<string, unknown> },
  ) => request<Artifact>(`/boards/${boardId}/artifacts`, { method: 'POST', ...json(input) }),
  patchArtifact: (
    boardId: string,
    artifactId: string,
    patch: Partial<Pick<Artifact, 'x' | 'y' | 'width' | 'height' | 'rotation'>> & {
      props?: Record<string, unknown>;
      toFront?: boolean;
    },
  ) =>
    request<Artifact>(`/boards/${boardId}/artifacts/${artifactId}`, {
      method: 'PATCH',
      ...json(patch),
    }),
  deleteArtifact: (boardId: string, artifactId: string) =>
    request<void>(`/boards/${boardId}/artifacts/${artifactId}`, { method: 'DELETE' }),

  createArrow: (
    boardId: string,
    input: { fromId: string; toId: string; fromSide?: string; toSide?: string },
  ) => request<Arrow>(`/boards/${boardId}/arrows`, { method: 'POST', ...json(input) }),
  patchArrow: (boardId: string, arrowId: string, patch: Record<string, unknown>) =>
    request<Arrow>(`/boards/${boardId}/arrows/${arrowId}`, { method: 'PATCH', ...json(patch) }),
  addBend: (boardId: string, arrowId: string, point: Vec2 & { index?: number }) =>
    request<Arrow>(`/boards/${boardId}/arrows/${arrowId}/bends`, { method: 'POST', ...json(point) }),
  moveBend: (boardId: string, arrowId: string, index: number, point: Vec2) =>
    request<Arrow>(`/boards/${boardId}/arrows/${arrowId}/bends/${index}`, {
      method: 'PATCH',
      ...json(point),
    }),
  removeBend: (boardId: string, arrowId: string, index: number) =>
    request<Arrow>(`/boards/${boardId}/arrows/${arrowId}/bends/${index}`, { method: 'DELETE' }),
  deleteArrow: (boardId: string, arrowId: string) =>
    request<void>(`/boards/${boardId}/arrows/${arrowId}`, { method: 'DELETE' }),

  messages: (boardId: string) => request<{ messages: ChatMessage[] }>(`/boards/${boardId}/messages`),
  clearMessages: (boardId: string) =>
    request<void>(`/boards/${boardId}/messages`, { method: 'DELETE' }),
  sendScreenshot: (requestId: string, dataUrl: string | null) =>
    request<{ accepted: boolean }>(`/screenshots/${requestId}`, { method: 'POST', ...json({ dataUrl }) }),

  knowledge: () => request<{ entries: KnowledgeEntry[]; stats: KnowledgeStats }>('/knowledge'),
  addKnowledge: (input: { title: string; text: string; tags?: string[] }) =>
    request<KnowledgeEntry>('/knowledge', { method: 'POST', ...json(input) }),
  deleteKnowledge: (id: string) => request<void>(`/knowledge/${id}`, { method: 'DELETE' }),
  searchKnowledge: (query: string, k?: number) =>
    request<{ hits: KnowledgeHit[]; stats: KnowledgeStats }>('/knowledge/search', {
      method: 'POST',
      ...json({ query, k }),
    }),
  reindexKnowledge: () =>
    request<{ stats: KnowledgeStats }>('/knowledge/reindex', { method: 'POST' }),

  skills: () => request<{ skills: Skill[] }>('/skills'),
  addSkill: (input: { name: string; when: string; body: string; slug?: string }) =>
    request<Skill>('/skills', { method: 'POST', ...json(input) }),
  updateSkill: (
    id: string,
    patch: Partial<Pick<Skill, 'name' | 'when' | 'body' | 'slug' | 'enabled'>>,
  ) => request<Skill>(`/skills/${id}`, { method: 'PATCH', ...json(patch) }),
  deleteSkill: (id: string) => request<void>(`/skills/${id}`, { method: 'DELETE' }),
  restoreSkills: () => request<{ skills: Skill[] }>('/skills/restore', { method: 'POST' }),
};

export { ApiError };
