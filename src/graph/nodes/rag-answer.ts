// Nó ragAnswer: envia ao modelo só os chunks recuperados (já sanitizados), entre <documento>. Parse inválido ou
// saída truncada viram recusa determinística (LLM-07); indisponibilidade, budget e fixture ausente propagam.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { LlmClient } from '../../llm/llm-client.ts';
import type { ragAnswerPrompt } from '../../prompts/v1/rag-answer.ts';
import { REFUSAL_TEXT } from '../../rag/citations.ts';
import type { StoredChunk } from '../../rag/vector-store.ts';
import { callContextFrom } from '../call-context.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { NODE } from '../routing.ts';
import { elapsedMs } from '../timing.ts';

export function createRagAnswerNode(deps: { llm: LlmClient; prompt: typeof ragAnswerPrompt; getChunk: (id: string) => StoredChunk | undefined }) {
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    if (!state.retrieval) throw new Error('ragAnswer called without retrieval in the state');
    const t0 = performance.now();
    const warnings: string[] = [];
    const chunks = state.retrieval.hits.flatMap((h) => {
      const c = deps.getChunk(h.chunkId);
      if (!c) { warnings.push(`chunk_missing:${h.chunkId}`); return []; }
      return [{ id: c.id, title: c.docTitle, heading: c.heading, text: c.text }];
    });
    const refuse = (warning: string): AskStateUpdate => ({
      outcome: { status: 'refused', blockedBy: null, answer: REFUSAL_TEXT, followUpQuestions: [] },
      warnings: [...warnings, warning],
      trace: [{ node: NODE.ragAnswer, ms: elapsedMs(t0), note: warning }],
    });
    if (chunks.length === 0) return refuse('no_chunks');

    const r = await deps.llm.generateStructured(deps.prompt, { question: state.question, chunks }, callContextFrom(config));
    if (!r.success) return refuse(r.error.kind === 'truncated' ? 'llm_truncated' : 'llm_parse_failed');
    return {
      draft: r.data,
      warnings,
      trace: [{ node: NODE.ragAnswer, ms: elapsedMs(t0), note: `${r.call.model} tentativas=${r.call.attempts}` }],
    };
  };
}
