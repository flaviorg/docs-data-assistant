// Validação das citações do ragAnswer (RAG-03, RAG-04): só valem IDs que estavam entre os recuperados.
import type { RagAnswerOutput } from '../domain/schemas.ts';

export const REFUSAL_TEXT = 'Não encontrei essa informação nos documentos da Moenda Lunar.';

export function validateCitations(draft: RagAnswerOutput, retrievedIds: readonly string[]): { citedIds: string[]; dropped: string[]; refused: boolean } {
  if (draft.refused) return { citedIds: [], dropped: [], refused: true };
  const citedIds: string[] = [];
  const dropped: string[] = [];
  for (const id of draft.citedChunkIds) {
    const bucket = retrievedIds.includes(id) ? citedIds : dropped;
    if (!bucket.includes(id)) bucket.push(id);
  }
  return { citedIds, dropped, refused: citedIds.length === 0 };
}
