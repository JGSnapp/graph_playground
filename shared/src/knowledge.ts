export type KnowledgeSource = 'seed' | 'user' | 'agent';

export interface KnowledgeEntry {
  id: string;
  title: string;
  text: string;
  tags: string[];
  source: KnowledgeSource;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeHit extends KnowledgeEntry {
  score: number;
  vectorScore: number;
  lexicalScore: number;
}

export interface KnowledgeStats {
  entries: number;
  dimensions: number;
  embeddingModel: string;
  /** True when embeddings come from the LLM provider instead of the local fallback. */
  remoteEmbeddings: boolean;
}
