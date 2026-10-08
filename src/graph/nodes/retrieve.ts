// Nó retrieve (RAG-01, RAG-02, GRD-04): busca top-k, avisa chunks neutralizados e recusa abaixo do limiar
// sem chamar o modelo. Recebe só o embedder, o vector store e o limiar.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { Embedder } from '../../embeddings/embedder.ts';
import { REFUSAL_TEXT } from '../../rag/citations.ts';
import type { StoredChunk, VectorStore } from '../../rag/vector-store.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { NODE } from '../routing.ts';
import { elapsedMs } from '../timing.ts';

export function createRetrieveNode(deps: { embedder: Embedder; store: VectorStore; topK: number; minScore: number }) {
  return async (state: AskState, _config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const t0 = performance.now();
    deps.store.assertEmbedder(deps.embedder.fingerprint);
    const [query] = await deps.embedder.embed([state.question]);
    const hits = deps.store.search(query!, deps.topK);
    const topScore = hits[0]?.score ?? 0;
    const flagged: StoredChunk[] = hits.filter((h) => h.chunk.flagged).map((h) => h.chunk);
    const warnings = flagged.map((c) => `chunk_neutralized:${c.id}`);
    const update: AskStateUpdate = {
      retrieval: {
        hits: hits.map((h) => ({ chunkId: h.chunk.id, score: h.score, sanitized: h.chunk.flagged })),
        topScore,
        threshold: deps.minScore,
      },
      redactedSpans: flagged.flatMap((c) => c.redactedSpans),
    };
    if (hits.length === 0 || topScore < deps.minScore) {
      warnings.push('below_threshold');
      update.outcome = { status: 'refused', blockedBy: null, answer: REFUSAL_TEXT, followUpQuestions: [] };
    }
    update.warnings = warnings;
    update.trace = [{ node: NODE.retrieve, ms: elapsedMs(t0), note: `top=${topScore.toFixed(3)} limiar=${deps.minScore}` }];
    return update;
  };
}
