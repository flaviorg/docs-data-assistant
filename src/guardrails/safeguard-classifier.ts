// SafeguardClassifier (GRD-02, GRD-03): chama o modelo de segurança pelo LlmClient e lê SAFE ou UNSAFE no início
// da resposta. Falha fechada: resposta fora do formato (classifier_unparseable) ou saída truncada (classifier_error)
// bloqueiam. Modelo de segurança indisponível depois dos retries propaga LlmUnavailableError, como qualquer modelo
// (LLM-03): a requisição responde 503, nenhuma pergunta passa sem veredito e a queda aparece em errorRate e no log.
// Abort da requisição, budget e fixture ausente também propagam (são desfechos da requisição, não do classificador).
import type { GuardrailVerdict } from '../domain/schemas.ts';
import type { LlmClient } from '../llm/llm-client.ts';
import type { safeguardPrompt } from '../prompts/v1/safeguard.ts';
import type { InjectionClassifier } from './classifier.ts';

const MAX_REASON_CHARS = 200;

export function parseSafeguardText(text: string): { verdict: 'safe' | 'unsafe' | 'unparseable'; reason: string } {
  const m = /^(unsafe|safe)\b([\s\S]*)$/i.exec(text.trim());
  if (!m) return { verdict: 'unparseable', reason: '' };
  const verdict = m[1]!.toLowerCase() as 'safe' | 'unsafe';
  const reason = verdict === 'unsafe' ? m[2]!.replace(/^[\s:.\-–—]+/, '').trim() : '';
  return { verdict, reason };
}

const blocked = (reason: string): GuardrailVerdict => ({ verdict: 'unsafe', layer: 'model', reasons: [reason] });

export function createSafeguardClassifier(deps: { llm: LlmClient; prompt: typeof safeguardPrompt }): InjectionClassifier {
  return {
    async classify(input, ctx) {
      const r = await deps.llm.generateText(deps.prompt, input, ctx);
      if (!r.success) return blocked('classifier_error');
      const parsed = parseSafeguardText(r.data);
      if (parsed.verdict === 'unparseable') return blocked('classifier_unparseable');
      if (parsed.verdict === 'unsafe') return blocked(`model:${(parsed.reason || 'no reason').slice(0, MAX_REASON_CHARS)}`);
      return { verdict: 'safe', layer: 'model', reasons: [] };
    },
  };
}
