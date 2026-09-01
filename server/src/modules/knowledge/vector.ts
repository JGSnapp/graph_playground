/**
 * A deliberately tiny vector database: dense float arrays in memory with cosine
 * similarity, combined with a BM25 lexical score for hybrid retrieval.
 * Good enough for thousands of records; swap for a real store when it isn't.
 */

export const tokenize = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);

export const l2normalize = (vec: number[]): number[] => {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
};

export const cosine = (a: number[], b: number[]): number => {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const fnv1a = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const LOCAL_EMBEDDING_DIMS = 384;

/**
 * Offline fallback embedding: hashed bag of tokens plus character trigrams, so
 * morphological variants ("аниме", "анимешный") still land near each other.
 */
export const localEmbed = (text: string, dims = LOCAL_EMBEDDING_DIMS): number[] => {
  const vec = new Array<number>(dims).fill(0);
  const tokens = tokenize(text);
  const bump = (key: string, weight: number) => {
    const h = fnv1a(key);
    vec[h % dims] += weight;
    vec[(h >>> 9) % dims] += weight * 0.5;
  };
  for (const token of tokens) {
    bump(token, 1);
    const padded = `^${token}$`;
    for (let i = 0; i + 3 <= padded.length; i++) bump(padded.slice(i, i + 3), 0.35);
  }
  return l2normalize(vec);
};

export interface LexicalDoc {
  id: string;
  tokens: string[];
}

/** Classic BM25 with the usual k1/b constants. */
export const bm25Scores = (
  query: string,
  docs: LexicalDoc[],
  k1 = 1.5,
  b = 0.75,
): Map<string, number> => {
  const queryTokens = tokenize(query);
  const scores = new Map<string, number>();
  if (docs.length === 0 || queryTokens.length === 0) return scores;

  const avgLen = docs.reduce((sum, d) => sum + d.tokens.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  for (const doc of docs) {
    const counts = new Map<string, number>();
    for (const term of doc.tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const tf = counts.get(term) ?? 0;
      if (tf === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.tokens.length) / avgLen)));
    }
    if (score > 0) scores.set(doc.id, score);
  }
  return scores;
};

export const normalizeScores = (scores: Map<string, number>): Map<string, number> => {
  let max = 0;
  for (const value of scores.values()) max = Math.max(max, value);
  if (max === 0) return scores;
  const out = new Map<string, number>();
  for (const [id, value] of scores) out.set(id, value / max);
  return out;
};
