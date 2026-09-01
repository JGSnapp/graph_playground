import type { ToolCallRecord } from '@teca/shared';
import { useState } from 'react';

const preview = (record: ToolCallRecord): string => {
  const args = record.args as Record<string, unknown> | undefined;
  if (!args || typeof args !== 'object') return '';
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined && typeof value !== 'object')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.join(' ');
};

const format = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ToolCallView = ({ record }: { record: ToolCallRecord }) => {
  const [open, setOpen] = useState(false);
  const duration = record.finishedAt ? record.finishedAt - record.startedAt : null;

  return (
    <div className={`tool-call ${record.status}`}>
      <button className="tool-head" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="tool-status" />
        <span className="tool-name">{record.name}</span>
        <span className="tool-preview">{preview(record)}</span>
        {duration != null && <span className="tool-time">{duration} мс</span>}
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-section">
            <span>аргументы</span>
            <pre>{format(record.args)}</pre>
          </div>
          {record.status === 'refused' ? (
            <div className="tool-section refused">
              <span>отказ</span>
              <pre>{record.refusalReason ?? format(record.result)}</pre>
            </div>
          ) : record.error ? (
            <div className="tool-section error">
              <span>ошибка</span>
              <pre>{record.error}</pre>
            </div>
          ) : (
            record.result !== undefined && (
              <div className="tool-section">
                <span>результат</span>
                <pre>{format(record.result)}</pre>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};
