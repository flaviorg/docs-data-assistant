// Nó checkCitations (RAG-03, RAG-04): descarta citações fora do conjunto recuperado e recusa se não sobrar nenhuma.
// O ID descartado é texto livre do modelo: só vai para o aviso se tiver o formato de ID de chunk e passar pela guarda
// de saída (GRD-05); senão o aviso leva INVALID_CITATION_ID, para o canário ou o system prompt não vazarem por ali.
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { OutputGuard } from '../../guardrails/output-guard.ts';
import { REFUSAL_TEXT, validateCitations } from '../../rag/citations.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { NODE } from '../routing.ts';
import { elapsedMs } from '../timing.ts';

export const INVALID_CITATION_ID = 'invalid_id';
const CHUNK_ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*#[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHUNK_ID_MAX = 120;

export function createCheckCitationsNode(deps: { outputGuard: OutputGuard }) {
  return async (state: AskState, _config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    if (!state.draft) throw new Error('checkCitations called without a draft in the state');
    const t0 = performance.now();
    const retrievedIds = (state.retrieval?.hits ?? []).map((h) => h.chunkId);
    const v = validateCitations(state.draft, retrievedIds);
    const shown = (id: string): string =>
      id.length <= CHUNK_ID_MAX && CHUNK_ID_SHAPE.test(id) && !deps.outputGuard.check(id, state.redactedSpans).blocked ? id : INVALID_CITATION_ID;
    const warnings = v.dropped.map((id) => `citation_dropped:${shown(id)}`);
    if (v.refused && !state.draft.refused) warnings.push('no_valid_citations');
    return {
      draft: { ...state.draft, citedChunkIds: v.citedIds },
      outcome: v.refused
        ? { status: 'refused', blockedBy: null, answer: REFUSAL_TEXT, followUpQuestions: [] }
        : { status: 'answered', blockedBy: null, answer: state.draft.answer, followUpQuestions: [] },
      warnings,
      trace: [{ node: NODE.checkCitations, ms: elapsedMs(t0), note: `citados=${v.citedIds.length} descartados=${v.dropped.length}` }],
    };
  };
}
