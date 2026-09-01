import type { ArtifactProps, ArtifactType } from '@teca/shared';

export interface ArtifactBlueprint {
  width: number;
  height: number;
  props: ArtifactProps;
  /** Documented for the agent so it knows which props each type accepts. */
  propsHint: string;
}

/**
 * Single source of truth for artifact kinds on the server: default geometry,
 * default props and the description handed to the LLM. Adding a kind = adding
 * an entry here plus a renderer in `web/src/artifacts`.
 */
export const ARTIFACT_BLUEPRINTS: Record<ArtifactType, ArtifactBlueprint> = {
  note: {
    width: 240,
    height: 180,
    props: { text: '', color: 'yellow' },
    propsHint: 'text: string (markdown-ish plain text), color: yellow|blue|green|pink|purple|gray',
  },
  text: {
    width: 320,
    height: 64,
    props: { text: '', fontSize: 24, weight: 600, align: 'left', color: '#e8e8ea' },
    propsHint: 'text: string, fontSize: number, weight: 400|600|700, align: left|center|right, color: css color',
  },
  shape: {
    width: 200,
    height: 140,
    props: { shape: 'rect', fill: '#1f2430', stroke: '#5b6478', label: '' },
    propsHint: 'shape: rect|ellipse|diamond|triangle, fill: css color, stroke: css color, label: string',
  },
  image: {
    width: 320,
    height: 240,
    props: { src: '', alt: '', fit: 'contain' },
    propsHint: 'src: image url or data url, alt: string, fit: contain|cover',
  },
  website: {
    width: 480,
    height: 360,
    props: { url: '', title: '' },
    propsHint: 'url: https url rendered in a sandboxed iframe, title: string',
  },
  console: {
    width: 460,
    height: 260,
    props: { title: 'console', cwd: '~', lines: [], status: 'idle' },
    propsHint: 'title: string, cwd: string, lines: string[] (terminal output), status: idle|running|error',
  },
  code: {
    width: 440,
    height: 280,
    props: { language: 'ts', code: '', title: '' },
    propsHint: 'language: string, code: string, title: string',
  },
};

export const blueprintFor = (type: ArtifactType): ArtifactBlueprint =>
  ARTIFACT_BLUEPRINTS[type] ?? ARTIFACT_BLUEPRINTS.note;
