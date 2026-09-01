import type { Attachment, Board, ChatMessage, Settings, SkillSummary } from '@teca/shared';
import { boardQuality, boundsOf } from '@teca/shared';
import type { ContentPart, ProviderMessage } from '../llm/types.js';

const MAX_LISTED_ARTIFACTS = 40;
const MAX_HISTORY_MESSAGES = 24;

/** Compact, always-fresh description of the board the agent is bound to. */
export const boardContext = (board: Board): string => {
  const { artifacts, arrows } = board.state;
  const lines = [
    `Доска: "${board.title}" (id: ${board.id})`,
    board.description ? `Описание: ${board.description}` : '',
    `Артефактов: ${artifacts.length}, стрелок: ${arrows.length}`,
  ].filter(Boolean);

  if (artifacts.length > 0) {
    const bounds = boundsOf(artifacts);
    lines.push(
      `Занятая область: x=${bounds.x} y=${bounds.y} w=${bounds.width} h=${bounds.height}`,
      'Артефакты:',
      ...artifacts
        .slice(0, MAX_LISTED_ARTIFACTS)
        .map((a) => `  ${a.id} [${a.type}] @(${a.x},${a.y}) ${a.width}x${a.height}`),
    );
    if (artifacts.length > MAX_LISTED_ARTIFACTS) {
      lines.push(`  … ещё ${artifacts.length - MAX_LISTED_ARTIFACTS}, смотри board_get_region`);
    }
    if (arrows.length > 0) {
      const quality = boardQuality(artifacts, arrows);
      lines.push(`Качество раскладки: ${quality.score}/100 (${quality.grade}), штраф ${quality.cost}`);
    }
  } else {
    lines.push('Доска пустая. Начинай композицию около точки (0, 0).');
  }
  return lines.join('\n');
};

/** Catalog only: the agent pulls the full body with skill_get when it matches. */
export const skillsContext = (skills: SkillSummary[], settings: Settings): string => {
  if (!settings.skills.enabled) return 'Скиллы отключены в настройках.';
  if (skills.length === 0) return 'Скиллов пока нет.';
  return [
    'Прежде чем менять доску, подбери скилл и прочитай его через skill_get(slug):',
    ...skills.map((skill) => `  ${skill.slug} — ${skill.name}. Когда: ${skill.when}`),
  ].join('\n');
};

export const knowledgeContext = (settings: Settings): string => {
  if (!settings.knowledge.readEnabled) return 'База знаний отключена в настройках.';
  return settings.knowledge.writeEnabled
    ? 'База знаний доступна: kb_search для поиска, kb_add для сохранения новых фактов.'
    : 'База знаний доступна только для чтения через kb_search.';
};

export const systemMessage = (
  board: Board,
  settings: Settings,
  skills: SkillSummary[] = [],
): ProviderMessage => ({
  role: 'system',
  content: [
    settings.agent.systemPrompt,
    '--- Скиллы ---',
    skillsContext(skills, settings),
    '--- Текущее состояние доски ---',
    boardContext(board),
    '--- База знаний ---',
    knowledgeContext(settings),
  ].join('\n\n'),
});

const attachmentParts = (attachments: Attachment[] = []): ContentPart[] =>
  attachments.flatMap((attachment): ContentPart[] => {
    if (attachment.kind === 'image' && attachment.dataUrl) {
      return [{ type: 'image_url' as const, image_url: { url: attachment.dataUrl } }];
    }
    if (attachment.text) {
      return [
        {
          type: 'text' as const,
          text: `Вложение "${attachment.name}":\n${attachment.text.slice(0, 20_000)}`,
        },
      ];
    }
    return [{ type: 'text' as const, text: `Вложение "${attachment.name}" (${attachment.mime})` }];
  });

export const userMessage = (text: string, attachments: Attachment[] = []): ProviderMessage => {
  const parts = attachmentParts(attachments);
  if (parts.length === 0) return { role: 'user', content: text };
  return { role: 'user', content: [{ type: 'text', text }, ...parts] };
};

/**
 * Past turns are flattened to plain text (tool calls become a short note) so the
 * provider never sees a dangling tool_call without its tool result.
 */
export const historyMessages = (messages: ChatMessage[]): ProviderMessage[] =>
  messages
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((message) => {
      if (message.role === 'user') return userMessage(message.content, message.attachments);
      const toolNote = message.toolCalls?.length
        ? `\n[вызванные инструменты: ${message.toolCalls.map((t) => t.name).join(', ')}]`
        : '';
      return { role: 'assistant' as const, content: `${message.content}${toolNote}`.trim() || '…' };
    });
