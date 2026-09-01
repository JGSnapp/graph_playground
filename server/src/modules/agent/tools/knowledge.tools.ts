import { int, objectSchema, str, type ToolSpec } from './types.js';

export const kbSearch: ToolSpec = {
  name: 'kb_search',
  description:
    'Семантический (векторный + лексический) поиск по базе знаний платформы. Используй, когда нужен фактический материал для содержимого артефактов.',
  parameters: objectSchema(
    {
      query: str('Поисковый запрос на естественном языке'),
      k: int('Сколько записей вернуть, по умолчанию из настроек'),
    },
    ['query'],
  ),
  isEnabled: (settings) => settings.knowledge.readEnabled,
  run: async (args, ctx) => {
    const topK = (args.k as number | undefined) ?? ctx.settings.knowledge.topK;
    const hits = await ctx.knowledge.search(args.query as string, topK);
    return {
      data: {
        query: args.query,
        hits: hits.map((hit) => ({
          id: hit.id,
          title: hit.title,
          text: hit.text,
          tags: hit.tags,
          score: Number(hit.score.toFixed(4)),
        })),
      },
    };
  },
};

export const kbAdd: ToolSpec = {
  name: 'kb_add',
  description:
    'Добавляет новую запись в базу знаний, чтобы переиспользовать её в следующих сессиях. Сначала проверь через kb_search, что такой записи ещё нет.',
  parameters: objectSchema(
    {
      title: str('Короткий заголовок записи'),
      text: str('Текст записи'),
      tags: { type: 'array', description: 'Теги записи', items: { type: 'string' } },
    },
    ['title', 'text'],
  ),
  isEnabled: (settings) => settings.knowledge.readEnabled && settings.knowledge.writeEnabled,
  run: async (args, ctx) => {
    const entry = await ctx.knowledge.add({
      title: args.title as string,
      text: args.text as string,
      tags: (args.tags as string[] | undefined) ?? [],
      source: 'agent',
    });
    return { data: { id: entry.id, title: entry.title } };
  },
};

export const knowledgeTools: ToolSpec[] = [kbSearch, kbAdd];
