// RuleClassifier (GRD-01): aplica as regras de injeção à pergunta. Determinístico, sem LLM.
import { matchRules } from './rules.ts';
import type { InjectionClassifier } from './classifier.ts';

export function createRuleClassifier(): InjectionClassifier {
  return {
    async classify(input) {
      const r = matchRules(input.question, 'input');
      if (r.blocked) return { verdict: 'unsafe', layer: 'rules', reasons: r.matches.map((m) => m.id) };
      return { verdict: 'safe', layer: 'rules', reasons: [] };
    },
  };
}
