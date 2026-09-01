import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/components/chat/Composer';
import { ToolCallView } from '../src/components/chat/ToolCallView';

describe('composer', () => {
  it('sends on Enter and clears the field', () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} running={false} onSend={onSend} onStop={vi.fn()} />);

    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'разложи заметки' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('разложи заметки', []);
    expect(field.value).toBe('');
  });

  it('keeps typing on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} running={false} onSend={onSend} onStop={vi.fn()} />);

    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'первая строка' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send empty messages', () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} running={false} onSend={onSend} onStop={vi.fn()} />);
    fireEvent.click(screen.getByText('Отправить'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('offers a stop button while the agent is running', () => {
    const onStop = vi.fn();
    render(<Composer disabled={false} running onSend={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByText('Стоп'));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('tool call view', () => {
  const record = {
    id: 'c1',
    name: 'artifact_create',
    args: { type: 'note', x: 40, y: 80 },
    status: 'done' as const,
    result: { id: 'art_1' },
    startedAt: 100,
    finishedAt: 180,
  };

  it('summarizes the call and reveals details on click', () => {
    render(<ToolCallView record={record} />);

    expect(screen.getByText('artifact_create')).toBeTruthy();
    expect(screen.getByText('type=note x=40 y=80')).toBeTruthy();
    expect(screen.getByText('80 мс')).toBeTruthy();
    expect(screen.queryByText('результат')).toBeNull();

    fireEvent.click(screen.getByText('artifact_create'));
    expect(screen.getByText('результат')).toBeTruthy();
    expect(screen.getByText(/"art_1"/)).toBeTruthy();
  });

  it('shows the error instead of the result for failed calls', () => {
    render(<ToolCallView record={{ ...record, status: 'error', error: 'Artifact art_9 not found' }} />);
    fireEvent.click(screen.getByText('artifact_create'));
    expect(screen.getByText('ошибка')).toBeTruthy();
    expect(screen.getByText('Artifact art_9 not found')).toBeTruthy();
  });
});
