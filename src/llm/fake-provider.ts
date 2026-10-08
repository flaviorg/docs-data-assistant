// Provedor fake (spec 001): substitui só a chamada ao modelo, respondendo pelas fixtures. Sem resposta genérica.
import { FixtureMissingError, LlmError } from '../domain/errors.ts';
import type { ChaosMode } from '../config.ts';
import type { PromptId } from '../prompts/prompt.ts';
import type { FixtureIndex } from './fixtures.ts';
import type { LlmProvider, ProviderRequest, ProviderResponse } from './provider.ts';
import { estimateTokens } from './tokens.ts';

export interface FakeCall { promptId: PromptId; key: string; model: string; messages: ProviderRequest['messages'] }

export interface FakeProvider extends LlmProvider {
  readonly name: 'fake';
  readonly calls: FakeCall[];
  setChaos(mode: ChaosMode): void;
}

const PRIMARY = 'fake/primary';
const MAX_CHAOS_KEYS = 10_000;   // limite de memória num servidor longo com o caos ligado
/** Teto de `calls`: cada registro guarda as mensagens inteiras (o DDL vai junto), e `npm start` sem chave usa o fake. */
export const MAX_RECORDED_CALLS = 1_000;

export function createFakeProvider(opts: { fixtures: FixtureIndex; chaos?: ChaosMode }): FakeProvider {
  const calls: FakeCall[] = [];
  let chaos: ChaosMode = opts.chaos ?? 'none';
  // primary-timeout-once vale uma vez por requisição (meta.requestId), para requisições concorrentes não dividirem
  // o estado de caos; sem requestId (testes diretos do provider), uma vez por provider.
  const timedOut = new Set<string>();

  return {
    name: 'fake',
    calls,
    setChaos(mode) {
      chaos = mode;
      timedOut.clear();
    },
    async chat(req, signal): Promise<ProviderResponse> {
      const { promptId, promptVersion, fixtureKey } = req.meta;
      calls.push({ promptId, key: fixtureKey, model: req.model, messages: req.messages.map((m) => ({ ...m })) });
      if (calls.length > MAX_RECORDED_CALLS) calls.splice(0, calls.length - MAX_RECORDED_CALLS);
      if (signal.aborted) throw new LlmError('timeout', 'chamada abortada antes de responder');

      if (chaos === 'all-down') throw new LlmError('server_error', `caos all-down: ${req.model} indisponível`);
      if (chaos === 'primary-down' && req.model === PRIMARY) throw new LlmError('server_error', 'caos primary-down: fake/primary indisponível');
      const chaosKey = req.meta.requestId ?? '';
      if (chaos === 'primary-timeout-once' && req.model === PRIMARY && !timedOut.has(chaosKey)) {
        if (timedOut.size >= MAX_CHAOS_KEYS) timedOut.clear();
        timedOut.add(chaosKey);
        throw new LlmError('timeout', 'caos primary-timeout-once: primeira chamada a fake/primary expirou');
      }

      const entry = opts.fixtures.lookup(promptId, promptVersion, fixtureKey);
      if (!entry) throw new FixtureMissingError(promptId, promptVersion, fixtureKey);
      // Prompts de texto (safeguard) guardam a resposta como string; os estruturados, como objeto JSON.
      const content = typeof entry.response === 'string' ? entry.response : JSON.stringify(entry.response);
      const usage = entry.usage
        ? { ...entry.usage, estimated: false }
        : {
            promptTokens: estimateTokens(req.messages.map((m) => m.content).join('\n')),
            completionTokens: estimateTokens(content),
            estimated: true,
          };
      return { content, model: req.model, finishReason: 'stop', usage };
    },
  };
}
