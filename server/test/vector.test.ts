import { describe, expect, it } from 'vitest';
import {
  bm25Scores,
  cosine,
  l2normalize,
  localEmbed,
  normalizeScores,
  tokenize,
} from '../src/modules/knowledge/vector.js';

describe('vector primitives', () => {
  it('tokenizes cyrillic and latin, dropping single characters', () => {
    expect(tokenize('Studio Ghibli — аниме, 1985 г.')).toEqual([
      'studio',
      'ghibli',
      'аниме',
      '1985',
    ]);
  });

  it('normalizes vectors to unit length', () => {
    const vec = l2normalize([3, 4]);
    expect(Math.hypot(...vec)).toBeCloseTo(1, 10);
  });

  it('cosine is 1 for identical and 0 for orthogonal vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('local embeddings are deterministic and unit length', () => {
    const a = localEmbed('Хаяо Миядзаки основал студию Ghibli');
    const b = localEmbed('Хаяо Миядзаки основал студию Ghibli');
    expect(a).toEqual(b);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
  });

  it('local embeddings put related texts closer than unrelated ones', () => {
    const query = localEmbed('студия Ghibli и Миядзаки');
    const related = localEmbed('Studio Ghibli основана Хаяо Миядзаки в 1985 году');
    const unrelated = localEmbed('гача-механика в мобильных играх и баннеры');
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it('ranks documents by bm25 relevance', () => {
    const docs = [
      { id: 'a', tokens: tokenize('покемоны нинтендо игры пикачу') },
      { id: 'b', tokens: tokenize('киберпанк неон импланты хакеры') },
    ];
    const scores = normalizeScores(bm25Scores('пикачу покемоны', docs));
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeUndefined();
  });
});
