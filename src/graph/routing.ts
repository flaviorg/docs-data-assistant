// Funções de roteamento do grafo (spec 004), puras e testadas à parte. Regra comum: outcome presente → finalize;
// pendingError → sqlCorrect; senão o próximo nó do caminho feliz.
import type { AskState } from './state.ts';

export const NODE = {
  guardrailInput: 'guardrailInput',
  router: 'router',
  outOfScope: 'outOfScope',
  retrieve: 'retrieve',
  ragAnswer: 'ragAnswer',
  checkCitations: 'checkCitations',
  sqlGenerate: 'sqlGenerate',
  sqlValidate: 'sqlValidate',
  sqlCorrect: 'sqlCorrect',
  sqlExecute: 'sqlExecute',
  sqlAnswer: 'sqlAnswer',
  finalize: 'finalize',
} as const;
export type NodeName = (typeof NODE)[keyof typeof NODE];

export function routeAfterGuardrail(s: AskState): typeof NODE.finalize | typeof NODE.router {
  return s.outcome ? NODE.finalize : NODE.router;
}

export function routeAfterRouter(s: AskState): typeof NODE.finalize | typeof NODE.retrieve | typeof NODE.sqlGenerate | typeof NODE.outOfScope {
  if (s.outcome) return NODE.finalize;
  if (s.route?.intent === 'docs') return NODE.retrieve;
  if (s.route?.intent === 'data') return NODE.sqlGenerate;
  return NODE.outOfScope;   // out_of_scope ou rota ausente: fallback seguro
}

export function routeAfterRetrieve(s: AskState): typeof NODE.finalize | typeof NODE.ragAnswer {
  return s.outcome ? NODE.finalize : NODE.ragAnswer;
}

export function routeAfterSqlGenerate(s: AskState): typeof NODE.finalize | typeof NODE.sqlCorrect | typeof NODE.sqlValidate {
  if (s.outcome) return NODE.finalize;
  return s.sql?.pendingError ? NODE.sqlCorrect : NODE.sqlValidate;
}

export function routeAfterSqlValidate(s: AskState): typeof NODE.finalize | typeof NODE.sqlCorrect | typeof NODE.sqlExecute {
  if (s.outcome) return NODE.finalize;
  return s.sql?.pendingError ? NODE.sqlCorrect : NODE.sqlExecute;
}

export function routeAfterSqlExecute(s: AskState): typeof NODE.finalize | typeof NODE.sqlCorrect | typeof NODE.sqlAnswer {
  if (s.outcome) return NODE.finalize;
  return s.sql?.pendingError ? NODE.sqlCorrect : NODE.sqlAnswer;
}
