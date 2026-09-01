import type { ChatMessage } from '@teca/shared';
import { useState } from 'react';
import { Markdown } from '../Markdown';
import { ToolCallView } from './ToolCallView';

const compact = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);

/** Tokens the run actually cost. Silent when the provider reported nothing. */
const UsageChip = ({ usage }: { usage: NonNullable<ChatMessage['usage']> }) => {
  const parts = [
    `${compact(usage.promptTokens)} вход`,
    `${compact(usage.completionTokens)} выход`,
  ];
  if (usage.cachedTokens) parts.push(`${compact(usage.cachedTokens)} из кэша`);
  if (usage.reasoningTokens) parts.push(`${compact(usage.reasoningTokens)} ризонинг`);
  const title =
    `${usage.promptTokens} промпт + ${usage.completionTokens} ответ = ${usage.totalTokens} токенов ` +
    `за ${usage.calls} запрос(ов) к модели` +
    (usage.callsWithoutUsage > 0
      ? `; ещё ${usage.callsWithoutUsage} запрос(ов) провайдер не отчитал`
      : '');
  return (
    <span className="usage" title={title}>
      {compact(usage.totalTokens)} токенов ({parts.join(', ')})
    </span>
  );
};

export const MessageView = ({ message }: { message: ChatMessage }) => {
  const [showReasoning, setShowReasoning] = useState(false);
  const isUser = message.role === 'user';

  return (
    <article className={`message ${message.role}`}>
      <div className="message-head">
        <span className="role">{isUser ? 'вы' : 'агент'}</span>
        {message.model && !isUser && <span className="model">{message.model}</span>}
        {message.usage && !isUser && <UsageChip usage={message.usage} />}
      </div>

      {message.attachments && message.attachments.length > 0 && (
        <div className="attachments">
          {message.attachments.map((attachment) =>
            attachment.kind === 'image' && attachment.dataUrl ? (
              <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} />
            ) : (
              <span key={attachment.id} className="file-chip">
                {attachment.name}
              </span>
            ),
          )}
        </div>
      )}

      {message.reasoning ? (
        <div className="reasoning">
          <button type="button" onClick={() => setShowReasoning((v) => !v)}>
            {showReasoning ? 'скрыть рассуждения' : 'показать рассуждения'}
          </button>
          {showReasoning && <pre>{message.reasoning}</pre>}
        </div>
      ) : null}

      {message.toolCalls?.map((record) => <ToolCallView key={record.id} record={record} />)}

      {message.content && <Markdown className="message-body" text={message.content} />}
      {message.error && <div className="message-error">{message.error}</div>}
    </article>
  );
};
