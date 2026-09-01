import type { Attachment } from '@teca/shared';
import { useRef, useState } from 'react';

interface Props {
  disabled: boolean;
  running: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

const readFile = (file: File): Promise<Attachment> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isImage = file.type.startsWith('image/');
    reader.onerror = () => reject(reader.error);
    reader.onload = () =>
      resolve({
        id: `att_${Math.random().toString(36).slice(2, 10)}`,
        kind: isImage ? 'image' : 'file',
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        ...(isImage ? { dataUrl: String(reader.result) } : { text: String(reader.result) }),
      });
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });

export const Composer = ({ disabled, running, onSend, onStop }: Props) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const loaded = await Promise.all([...files].map(readFile));
    setAttachments((current) => [...current, ...loaded]);
  };

  const submit = () => {
    if (running || disabled) return;
    if (!text.trim() && attachments.length === 0) return;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
  };

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="attachment-chip">
              {attachment.kind === 'image' && attachment.dataUrl && (
                <img src={attachment.dataUrl} alt="" />
              )}
              {attachment.name}
              <button
                type="button"
                onClick={() => setAttachments((c) => c.filter((a) => a.id !== attachment.id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        value={text}
        placeholder={disabled ? 'Создайте доску, чтобы начать' : 'Опишите, что разместить на доске…'}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) void addFiles(files);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      />

      <div className="composer-actions">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} title="Прикрепить">
          📎
        </button>
        <div className="spacer" />
        {running ? (
          <button type="button" className="stop" onClick={onStop}>
            Стоп
          </button>
        ) : (
          <button type="button" className="primary" onClick={submit} disabled={disabled}>
            Отправить
          </button>
        )}
      </div>
    </div>
  );
};
