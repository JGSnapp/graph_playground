import type { Artifact, ChatMessage } from '@teca/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { artifactDefinition } from '../src/artifacts';
import { MessageView } from '../src/components/chat/MessageView';

const message = (content: string): ChatMessage => ({
  id: 'msg_1',
  boardId: 'brd_1',
  role: 'assistant',
  content,
  createdAt: 0,
});

const artifact = (type: Artifact['type'], props: Record<string, unknown>): Artifact => ({
  id: 'art_1',
  type,
  x: 0,
  y: 0,
  width: 240,
  height: 180,
  z: 1,
  props,
  createdAt: 0,
  updatedAt: 0,
});

describe('markdown rendering', () => {
  it('formats assistant messages instead of showing raw markers', () => {
    const { container } = render(
      <MessageView
        message={message('## Итог\n\nПоставил **три** заметки и `одну` стрелку.\n\n- первая\n- вторая')}
      />,
    );

    expect(container.querySelector('h2')?.textContent).toBe('Итог');
    expect(container.querySelector('strong')?.textContent).toBe('три');
    expect(container.querySelector('code')?.textContent).toBe('одну');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).not.toContain('**');
  });

  it('keeps single line breaks visible in chat', () => {
    const { container } = render(<MessageView message={message('первая строка\nвторая строка')} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('opens markdown links in a new tab', () => {
    const { container } = render(<MessageView message={message('[док](https://example.com)')} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noreferrer');
  });

  it('formats note artifacts but edits their raw source', () => {
    const onPatch = vi.fn();
    const { container } = render(
      <>
        {artifactDefinition('note').render({
          artifact: artifact('note', { text: '**Жирный** заголовок' }),
          selected: false,
          onPatch,
        })}
      </>,
    );

    expect(container.querySelector('strong')?.textContent).toBe('Жирный');

    fireEvent.doubleClick(screen.getByText('заголовок', { exact: false }));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor.value).toBe('**Жирный** заголовок');
  });

  it('leaves code artifacts as literal text', () => {
    const { container } = render(
      <>
        {artifactDefinition('code').render({
          artifact: artifact('code', { code: '# heading\n**not bold**' }),
          selected: false,
          onPatch: vi.fn(),
        })}
      </>,
    );

    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('**not bold**');
  });
});
