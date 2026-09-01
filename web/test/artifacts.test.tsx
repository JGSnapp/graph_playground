import { ARTIFACT_TYPES, type Artifact } from '@teca/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ARTIFACT_REGISTRY, artifactDefinition } from '../src/artifacts';

const make = (type: Artifact['type'], props: Record<string, unknown>): Artifact => ({
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

describe('artifact registry', () => {
  it('has a renderer for every artifact type the server can create', () => {
    for (const type of ARTIFACT_TYPES) {
      expect(ARTIFACT_REGISTRY[type], `missing renderer for ${type}`).toBeDefined();
      expect(ARTIFACT_REGISTRY[type].type).toBe(type);
    }
  });

  it('falls back to the note renderer for unknown types', () => {
    expect(artifactDefinition('hologram' as Artifact['type']).type).toBe('note');
  });

  it('renders note content and commits edits on blur', () => {
    const onPatch = vi.fn();
    render(
      <>
        {artifactDefinition('note').render({
          artifact: make('note', { text: 'исходный текст', color: 'blue' }),
          selected: false,
          onPatch,
        })}
      </>,
    );

    const view = screen.getByText('исходный текст');
    fireEvent.doubleClick(view);

    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'новый текст' } });
    fireEvent.blur(editor);

    expect(onPatch).toHaveBeenCalledWith({ text: 'новый текст' });
  });

  it('does not fire a patch when the edit is cancelled with Escape', () => {
    const onPatch = vi.fn();
    render(
      <>
        {artifactDefinition('text').render({
          artifact: make('text', { text: 'заголовок' }),
          selected: false,
          onPatch,
        })}
      </>,
    );

    fireEvent.doubleClick(screen.getByText('заголовок'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'испорчено' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText('заголовок')).toBeTruthy();
  });

  it('renders a sandboxed iframe for website artifacts', () => {
    const { container } = render(
      <>
        {artifactDefinition('website').render({
          artifact: make('website', { url: 'https://example.com' }),
          selected: false,
          onPatch: vi.fn(),
        })}
      </>,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('https://example.com');
    expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
  });

  it('splits console output into lines and writes it back as an array', () => {
    const onPatch = vi.fn();
    render(
      <>
        {artifactDefinition('console').render({
          artifact: make('console', { lines: ['$ npm test', 'ok'], title: 'build' }),
          selected: false,
          onPatch,
        })}
      </>,
    );

    fireEvent.doubleClick(screen.getByText(/npm test/));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: '$ npm run dev\nready' } });
    fireEvent.blur(editor);

    expect(onPatch).toHaveBeenCalledWith({ lines: ['$ npm run dev', 'ready'] });
  });
});
