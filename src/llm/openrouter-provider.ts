// Provedor OpenRouter pelo SDK `openai` com baseURL, maxRetries: 0 (o retry é do LlmClient) e fetch injetável.
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import { LlmError } from '../domain/errors.ts';
import type { LlmErrorKind, LlmProvider, ProviderRequest, ProviderResponse } from './provider.ts';
import { estimateTokens } from './tokens.ts';

type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: Record<string, unknown> } }
  | { type: 'json_object' };

// Palavras-chave de tamanho de string ficam fora do subconjunto que o modo strict de json_schema aceita na
// documentação da OpenAI; um provedor que siga essa regra devolveria 400 (bad_request, sem retry). Os limites
// continuam valendo no parse com Zod do LlmClient, que é quem decide se a saída serve.
const STRICT_UNSUPPORTED: ReadonlySet<string> = new Set(['minLength', 'maxLength']);

/** Cópia do JSON Schema sem as palavras-chave de STRICT_UNSUPPORTED, em qualquer profundidade. */
export function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node === null || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => !STRICT_UNSUPPORTED.has(k)).map(([k, v]) => [k, toStrictSchema(v)]));
}

function responseFormatFor(req: ProviderRequest, mode: 'json_schema' | 'json_object'): ResponseFormat | undefined {
  if (!req.responseFormat) return undefined;
  if (mode === 'json_object') return { type: 'json_object' };
  // z.toJSONSchema inclui a chave $schema, que o OpenRouter não aceita dentro de json_schema.schema.
  const { $schema: _drop, ...schema } = req.responseFormat.jsonSchema;
  return { type: 'json_schema', json_schema: { name: req.responseFormat.name, strict: true, schema: toStrictSchema(schema) as Record<string, unknown> } };
}

function kindForStatus(status: number): LlmErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

function toLlmError(err: unknown, signal: AbortSignal): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof APIUserAbortError || err instanceof APIConnectionTimeoutError || signal.aborted) {
    return new LlmError('timeout', 'a chamada ao provedor expirou ou foi abortada');
  }
  if (err instanceof APIConnectionError) return new LlmError('server_error', 'connection to the provider failed');
  if (err instanceof APIError && typeof err.status === 'number') {
    return new LlmError(kindForStatus(err.status), `provedor respondeu HTTP ${err.status}`);
  }
  return new LlmError('server_error', err instanceof Error ? err.message : String(err));
}

export function createOpenRouterProvider(opts: {
  apiKey: string;
  baseUrl: string;
  structuredMode: 'json_schema' | 'json_object';
  fetch?: typeof fetch;
}): LlmProvider {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 0, ...(opts.fetch ? { fetch: opts.fetch } : {}) });

  return {
    name: 'openrouter',
    async chat(req, signal): Promise<ProviderResponse> {
      if (signal.aborted) throw new LlmError('timeout', 'call aborted before starting');
      const responseFormat = responseFormatFor(req, opts.structuredMode);
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }, { signal });
      } catch (err) {
        throw toLlmError(err, signal);
      }

      const choice = completion.choices[0];
      if (choice?.finish_reason === 'length') throw new LlmError('truncated', `output truncated at ${req.maxTokens} tokens`);
      const content = choice?.message.content ?? '';
      if (content.trim() === '') throw new LlmError('bad_request', 'the provider returned empty content');
      const finishReason = choice?.finish_reason === 'stop' ? 'stop' : 'other';
      const usage = completion.usage
        ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens, estimated: false }
        : {
            promptTokens: estimateTokens(req.messages.map((m) => m.content).join('\n')),
            completionTokens: estimateTokens(content),
            estimated: true,
          };
      return { content, model: completion.model || req.model, finishReason, usage };
    },
  };
}
