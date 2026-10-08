// Nó guardrailInput (GRD-01 a GRD-03): regras sempre (exceto no modo off); com rules+model, o modelo de segurança
// só roda se as regras passarem. Veredito unsafe grava outcome blocked e o grafo pula para finalize. A falha fechada do
// classificador (classifier_unparseable, classifier_error) bloqueia com mensagem própria, sem acusar o usuário de injeção;
// modelo de segurança indisponível não chega aqui como veredito: o LlmUnavailableError propaga e vira 503 (LLM-03).
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { AppConfig } from '../../config.ts';
import type { InjectionClassifier } from '../../guardrails/classifier.ts';
import { callContextFrom } from '../call-context.ts';
import { BLOCKED_INPUT_MESSAGE, GUARDRAIL_CHECK_FAILED_MESSAGE } from '../messages.ts';
import { NODE } from '../routing.ts';
import type { AskState, AskStateUpdate } from '../state.ts';
import { elapsedMs } from '../timing.ts';

const CLASSIFIER_FAILURES: ReadonlySet<string> = new Set(['classifier_unparseable', 'classifier_error']);

export function createGuardrailInputNode(deps: {
  rules: InjectionClassifier;
  model: InjectionClassifier | null;
  mode: AppConfig['guardrailMode'];
  policy: string;
}) {
  if (deps.mode === 'rules+model' && !deps.model) throw new Error('GUARDRAIL_MODE=rules+model requires the model classifier');
  return async (state: AskState, config: LangGraphRunnableConfig): Promise<AskStateUpdate> => {
    if (state.outcome) return {};
    const t0 = performance.now();
    const trace = (note: string) => [{ node: NODE.guardrailInput, ms: elapsedMs(t0), note }];
    if (deps.mode === 'off') {
      return { guardrail: { verdict: 'safe', layer: null, reasons: [] }, warnings: ['guardrail_off'], trace: trace('off mode') };
    }
    const ctx = callContextFrom(config);
    const input = { question: state.question, policy: deps.policy };
    let verdict = await deps.rules.classify(input, ctx);
    if (verdict.verdict === 'safe' && deps.mode === 'rules+model' && deps.model) verdict = await deps.model.classify(input, ctx);
    if (verdict.verdict === 'unsafe') {
      const failed = verdict.layer === 'model' && verdict.reasons.every((r) => CLASSIFIER_FAILURES.has(r));
      return {
        guardrail: verdict,
        outcome: {
          status: 'blocked',
          blockedBy: verdict.layer === 'model' ? 'input_model' : 'input_rules',
          answer: failed ? GUARDRAIL_CHECK_FAILED_MESSAGE : BLOCKED_INPUT_MESSAGE,
          followUpQuestions: [],
        },
        trace: trace(`bloqueado: ${verdict.reasons.join(',')}`),
      };
    }
    return { guardrail: verdict, trace: trace(`safe (${verdict.layer ?? 'no layer'})`) };
  };
}
