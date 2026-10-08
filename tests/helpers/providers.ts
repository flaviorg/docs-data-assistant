// ScriptedProvider: provedor roteirizado para testes do LlmClient e dos nós. A última etapa se repete.
import { LlmError } from '../../src/domain/errors.ts';
import type { LlmProvider, ProviderRequest, ProviderResponse } from '../../src/llm/provider.ts';
import type { PromptId } from '../../src/prompts/prompt.ts';
import { createFakeProvider } from '../../src/llm/fake-provider.ts';
import { loadRealFixtures } from './fixtures.ts';

export type ScriptStep = ProviderResponse | LlmError | ((req: ProviderRequest) => ProviderResponse | LlmError);

export function createScriptedProvider(steps: ReadonlyArray<ScriptStep>): LlmProvider & { readonly name: 'scripted'; calls: ProviderRequest[] } {
  if (steps.length === 0) throw new Error('createScriptedProvider precisa de ao menos uma etapa');
  const calls: ProviderRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    calls,
    async chat(req) {
      calls.push(req);
      const step = steps[Math.min(i, steps.length - 1)]!;
      i++;
      const out = typeof step === 'function' ? step(req) : step;
      if (out instanceof LlmError) throw out;
      return out;
    },
  };
}

export function okJson(obj: unknown, overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return okText(JSON.stringify(obj), overrides);
}

export function okText(text: string, overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return {
    content: text,
    model: 'scripted',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, estimated: false },
    ...overrides,
  };
}

/** Provider que só responde quando o sinal aborta (com LlmError timeout): simula um modelo que nunca termina. */
export function waitsForAbortProvider(): LlmProvider & { readonly name: 'scripted'; calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  return {
    name: 'scripted',
    calls,
    chat(req, signal) {
      calls.push(req);
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new LlmError('timeout', 'chamada abortada'));
        if (signal.aborted) { fail(); return; }
        signal.addEventListener('abort', fail, { once: true });
      });
    },
  };
}

/** Provider com bug: lança TypeError (erro inesperado, vira 500 no AskService). */
export function throwsTypeErrorProvider(): LlmProvider & { readonly name: 'scripted' } {
  return {
    name: 'scripted',
    async chat() {
      throw new TypeError('cannot read properties of undefined (reading "choices")');
    },
  };
}

/**
 * ScriptedProvider (name 'scripted') que responde por req.meta.promptId com as etapas do mapa e delega os demais
 * prompts às fixtures reais (via provider fake). Serve para testar o modelo de segurança, que o fake não roda.
 */
export function scriptedByPrompt(map: Partial<Record<PromptId, ScriptStep>>): LlmProvider & { readonly name: 'scripted'; calls: ProviderRequest[] } {
  const delegate = createFakeProvider({ fixtures: loadRealFixtures() });
  const calls: ProviderRequest[] = [];
  return {
    name: 'scripted',
    calls,
    async chat(req, signal) {
      calls.push(req);
      const step = map[req.meta.promptId];
      if (step === undefined) return delegate.chat(req, signal);
      const out = typeof step === 'function' ? step(req) : step;
      if (out instanceof LlmError) throw out;
      return out;
    },
  };
}
