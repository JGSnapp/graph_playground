import type { Board } from '@teca/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { useStore } from '../src/state/store';

const board: Board = {
  id: 'brd_1',
  title: 'Пайплайн',
  description: '',
  model: 'gpt-5.6-terra',
  state: {
    artifacts: [
      {
        id: 'art_1',
        type: 'note',
        x: 40,
        y: 40,
        width: 240,
        height: 180,
        z: 1,
        props: { text: 'этап загрузки', color: 'yellow' },
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'art_2',
        type: 'console',
        x: 400,
        y: 40,
        width: 460,
        height: 260,
        z: 2,
        props: { title: 'runner', cwd: '~/teca', lines: ['$ npm test'], status: 'idle' },
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    arrows: [
      {
        id: 'arr_1',
        from: { artifactId: 'art_1', side: 'right' },
        to: { artifactId: 'art_2', side: 'left' },
        bends: [{ x: 340, y: 90 }],
        label: 'запускает',
        style: {},
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  },
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: 0,
  updatedAt: 0,
};

describe('application shell', () => {
  beforeEach(() => {
    useStore.setState({
      ready: false,
      boards: [],
      activeBoardId: null,
      history: {},
      messages: {},
      models: [],
      settings: null,
      runs: {},
      selection: {},
      error: null,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/boards')) return Response.json({ boards: [board], summaries: [] });
        if (url.endsWith('/api/settings')) {
          return Response.json({
            provider: {
              baseUrl: 'https://api.dslab.tech/v1',
              defaultModel: 'gpt-5.6-terra',
              embeddingModel: 'text-embedding-3-small',
              apiKeySet: false,
            },
            agent: {
              systemPrompt: 'системный промпт',
              maxIterations: 12,
              unlimitedIterations: false,
              providerRetries: 3,
              temperature: 0.3,
              maxTokens: 8192,
            },
            knowledge: { readEnabled: true, writeEnabled: true, topK: 5 },
            skills: { enabled: true },
          });
        }
        if (url.endsWith('/api/skills')) {
          return Response.json({
            skills: [
              {
                id: 'skl_1',
                slug: 'graph-layout',
                name: 'Построение графа',
                when: 'Нужна связная структура',
                body: '# Построение графа\n\nСначала узлы, потом стрелки.',
                enabled: true,
                source: 'builtin',
                createdAt: 0,
                updatedAt: 0,
              },
            ],
          });
        }
        if (url.includes('/api/models')) {
          return Response.json({
            models: [
              { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
              { id: 'claude-opus-5', label: 'Claude Opus 5' },
            ],
            source: 'api',
          });
        }
        if (url.endsWith('/messages')) return Response.json({ messages: [] });
        if (url.includes('/api/boards/brd_1')) {
          return Response.json({ board, history: { canUndo: true, canRedo: false } });
        }
        if (url.endsWith('/api/knowledge')) {
          return Response.json({
            entries: [
              { id: 'kb_1', title: 'Studio Ghibli', text: 'Аниме-студия', tags: ['аниме'], source: 'seed', createdAt: 0, updatedAt: 0 },
            ],
            stats: { entries: 1, dimensions: 384, embeddingModel: 'local:hashed-v1', remoteEmbeddings: false },
          });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the board strip, its artifacts and the arrow between them', async () => {
    const { container } = render(<App />);

    expect(await screen.findByRole('button', { name: 'Пайплайн' })).toBeTruthy();
    expect(screen.getByText('этап загрузки')).toBeTruthy();
    expect(screen.getByText(/runner/)).toBeTruthy();
    expect(screen.getByText('2 арт · 1 связей')).toBeTruthy();
    expect(container.querySelectorAll('.artifact')).toHaveLength(2);
    expect(container.querySelector('.arrow-layer path')).toBeTruthy();
    expect(screen.getByText('запускает')).toBeTruthy();
  });

  it('binds the chat to the active board and offers its model', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    expect(screen.getByText('Чат с агентом')).toBeTruthy();
    // The chat header names the board whose agent is answering.
    expect(document.querySelector('.chat-title strong')?.textContent).toBe('Пайплайн');
    const selects = screen.getAllByTitle(/Модель/) as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThan(0);
    expect(selects[0].value).toBe('gpt-5.6-terra');
    expect(screen.getByPlaceholderText(/Опишите, что разместить/)).toBeTruthy();
  });

  it('enables undo only when the board has history', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    expect((screen.getByTitle('Отменить') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle('Вернуть') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an artifact menu covering every registered type', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    fireEvent.click(screen.getByTitle('Добавить артефакт'));
    for (const label of ['Заметка', 'Текст', 'Фигура', 'Изображение', 'Сайт', 'Консоль', 'Код']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('opens settings and switches between its sections', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    fireEvent.click(screen.getByText('Настройки'));
    expect(await screen.findByDisplayValue('https://api.dslab.tech/v1')).toBeTruthy();
    expect(screen.getByText('не задан')).toBeTruthy();

    fireEvent.click(screen.getByText('Системный промпт'));
    expect(screen.getByDisplayValue('системный промпт')).toBeTruthy();

    fireEvent.click(screen.getByText('База знаний'));
    await waitFor(() => expect(screen.getByText('Studio Ghibli')).toBeTruthy());
    expect(screen.getByText(/локальные эмбеддинги/)).toBeTruthy();
  });

  it('edits skills in the settings dialog', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    fireEvent.click(screen.getByText('Настройки'));
    fireEvent.click(screen.getByText('Скиллы'));

    await waitFor(() => expect(screen.getByText('Построение графа')).toBeTruthy());
    expect(screen.getByText('graph-layout')).toBeTruthy();
    const body = screen.getByDisplayValue(/Сначала узлы, потом стрелки/) as HTMLTextAreaElement;
    expect((screen.getByText('Сохранить') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(body, { target: { value: '# Правка' } });
    expect((screen.getByText('Сохранить') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Есть несохранённые правки')).toBeTruthy();
  });

  it('shows the layout quality score in the board header', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    const badge = document.querySelector('.badge.quality') as HTMLElement;
    expect(badge.textContent).toMatch(/^\d+\/100$/);
    expect(badge.title).toMatch(/Качество раскладки/);
  });

  it('selects an artifact on pointer down and exposes connection anchors', async () => {
    const { container } = render(<App />);
    await screen.findByRole('button', { name: 'Пайплайн' });

    const artifact = container.querySelector('.artifact') as HTMLElement;
    fireEvent.pointerDown(artifact, { clientX: 50, clientY: 50 });

    expect(artifact.className).toContain('selected');
    expect(container.querySelectorAll('.anchor')).toHaveLength(4);
    expect(container.querySelector('.resize-handle')).toBeTruthy();
  });
});
