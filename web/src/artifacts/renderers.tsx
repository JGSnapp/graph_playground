import { EditableText } from './EditableText';
import type { ArtifactDefinition, ArtifactViewProps } from './types';

const str = (props: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = props[key];
  return typeof value === 'string' ? value : fallback;
};

const num = (props: Record<string, unknown>, key: string, fallback: number): number => {
  const value = props[key];
  return typeof value === 'number' ? value : fallback;
};

const NoteView = ({ artifact, onPatch }: ArtifactViewProps) => (
  <div className={`artifact-note note-${str(artifact.props, 'color', 'yellow')}`}>
    <EditableText
      value={str(artifact.props, 'text')}
      placeholder="Заметка"
      markdown
      onCommit={(text) => onPatch({ text })}
    />
  </div>
);

const TextView = ({ artifact, onPatch }: ArtifactViewProps) => (
  <EditableText
    value={str(artifact.props, 'text')}
    placeholder="Текст"
    className="artifact-plain-text"
    markdown
    style={{
      fontSize: num(artifact.props, 'fontSize', 24),
      fontWeight: num(artifact.props, 'weight', 600),
      textAlign: str(artifact.props, 'align', 'left') as 'left',
      color: str(artifact.props, 'color', '#e8e8ea'),
    }}
    onCommit={(text) => onPatch({ text })}
  />
);

const ShapeView = ({ artifact, onPatch }: ArtifactViewProps) => {
  const shape = str(artifact.props, 'shape', 'rect');
  const fill = str(artifact.props, 'fill', '#1f2430');
  const stroke = str(artifact.props, 'stroke', '#5b6478');
  const w = artifact.width;
  const h = artifact.height;
  const geometry =
    shape === 'ellipse' ? (
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} fill={fill} stroke={stroke} strokeWidth="1.5" />
    ) : shape === 'diamond' ? (
      <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} fill={fill} stroke={stroke} strokeWidth="1.5" />
    ) : shape === 'triangle' ? (
      <polygon points={`${w / 2},1 ${w - 1},${h - 1} 1,${h - 1}`} fill={fill} stroke={stroke} strokeWidth="1.5" />
    ) : (
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="10" fill={fill} stroke={stroke} strokeWidth="1.5" />
    );

  return (
    <div className="artifact-shape">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {geometry}
      </svg>
      <div className="artifact-shape-label">
        <EditableText
          value={str(artifact.props, 'label')}
          placeholder=""
          onCommit={(label) => onPatch({ label })}
        />
      </div>
    </div>
  );
};

const ImageView = ({ artifact, onPatch }: ArtifactViewProps) => {
  const src = str(artifact.props, 'src');
  if (!src) {
    return (
      <div className="artifact-empty">
        <span>изображение</span>
        <EditableText value="" placeholder="вставь URL" onCommit={(value) => onPatch({ src: value })} />
      </div>
    );
  }
  return (
    <img
      className="artifact-image"
      src={src}
      alt={str(artifact.props, 'alt')}
      style={{ objectFit: str(artifact.props, 'fit', 'contain') as 'contain' }}
      draggable={false}
    />
  );
};

const WebsiteView = ({ artifact, onPatch }: ArtifactViewProps) => {
  const url = str(artifact.props, 'url');
  return (
    <div className="artifact-website">
      <div className="artifact-website-bar">
        <EditableText value={url} placeholder="https://" onCommit={(value) => onPatch({ url: value })} />
      </div>
      {url ? (
        <iframe
          title={str(artifact.props, 'title', url)}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : (
        <div className="artifact-empty">сайт не задан</div>
      )}
    </div>
  );
};

const ConsoleView = ({ artifact, onPatch }: ArtifactViewProps) => {
  const raw = artifact.props.lines;
  const lines = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split('\n').filter(Boolean);
  const status = str(artifact.props, 'status', 'idle');
  return (
    <div className={`artifact-console status-${status}`}>
      <div className="artifact-console-bar">
        <span className="dot" />
        {str(artifact.props, 'title', 'console')} — {str(artifact.props, 'cwd', '~')}
      </div>
      <div className="artifact-console-body">
        <EditableText
          value={lines.join('\n')}
          placeholder="$ ..."
          onCommit={(value) => onPatch({ lines: value.split('\n') })}
        />
      </div>
    </div>
  );
};

const CodeView = ({ artifact, onPatch }: ArtifactViewProps) => (
  <div className="artifact-code">
    <div className="artifact-code-bar">
      {str(artifact.props, 'title') || str(artifact.props, 'language', 'code')}
    </div>
    <div className="artifact-code-body">
      <EditableText
        value={str(artifact.props, 'code')}
        placeholder="// код"
        onCommit={(code) => onPatch({ code })}
      />
    </div>
  </div>
);

/** Renderer per artifact type; extend the platform by adding an entry here. */
export const ARTIFACT_DEFINITIONS: ArtifactDefinition[] = [
  { type: 'note', label: 'Заметка', glyph: '▤', render: NoteView },
  { type: 'text', label: 'Текст', glyph: 'T', render: TextView },
  { type: 'shape', label: 'Фигура', glyph: '◇', render: ShapeView },
  { type: 'image', label: 'Изображение', glyph: '▣', render: ImageView },
  { type: 'website', label: 'Сайт', glyph: '⌘', render: WebsiteView },
  { type: 'console', label: 'Консоль', glyph: '›_', render: ConsoleView },
  { type: 'code', label: 'Код', glyph: '{}', render: CodeView },
];
