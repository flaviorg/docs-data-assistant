// Contrato de um provedor de chat (spec 001). Fake, OpenRouter e o ScriptedProvider dos testes implementam.
import type { PromptId } from '../prompts/prompt.ts';

export interface ProviderRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  maxTokens: number;
  responseFormat?: { name: string; jsonSchema: Record<string, unknown> };
  // requestId: opcional, para estado por requisição no fake (caos primary-timeout-once); o OpenRouter ignora.
  meta: { promptId: PromptId; promptVersion: string; fixtureKey: string; requestId?: string };
}

export interface ProviderResponse {
  content: string;
  model: string;
  finishReason: 'stop' | 'length' | 'other';
  usage: { promptTokens: number; completionTokens: number; estimated: boolean };
}

export interface LlmProvider {
  readonly name: 'fake' | 'openrouter' | 'scripted';
  chat(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>; // lança LlmError
}

export type LlmErrorKind =
  | 'timeout' | 'rate_limit' | 'server_error'    // retentáveis no mesmo modelo
  | 'bad_request' | 'auth'                       // não retentáveis; vão ao fallback uma vez
  | 'truncated' | 'fixture_missing';             // nem retry nem fallback
