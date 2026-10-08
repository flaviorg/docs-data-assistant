import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, MIN_SCORE_DEFAULTS, ENV_KEYS } from '../../src/config.ts';
import { ConfigError, FixtureMissingError, BudgetExceededError, LlmError } from '../../src/domain/errors.ts';

test('ENV-01 sem variáveis usa fake e hash', () => {
  const c = loadConfig({ env: {} });
  assert.equal(c.llm.provider, 'fake');
  assert.equal(c.rag.embedder, 'hash');
  assert.equal(c.guardrailMode, 'rules');
  assert.equal(c.llm.maxCallsPerRequest, 8);
  assert.equal(c.llm.maxRetries, 2);
  assert.equal(c.rag.minScore, MIN_SCORE_DEFAULTS['hash-v1']);
});
test('ENV-02 openrouter sem chave falha nomeando a variável', () => {
  assert.throws(() => loadConfig({ env: { LLM_PROVIDER: 'openrouter' } }),
    (e: unknown) => e instanceof ConfigError && /OPENROUTER_API_KEY/.test(e.message));
});
test('só a chave seleciona openrouter e rules+model', () => {
  const c = loadConfig({ env: { OPENROUTER_API_KEY: 'sk-or-x' } });
  assert.equal(c.llm.provider, 'openrouter');
  assert.equal(c.guardrailMode, 'rules+model');
});
test('ENV-01 string vazia conta como ausente', () => {
  assert.equal(loadConfig({ env: { LLM_PROVIDER: '' } }).llm.provider, 'fake');
});
test('EMBEDDER=minilm falha citando o marco M9', () => {
  assert.throws(() => loadConfig({ env: { EMBEDDER: 'minilm' } }), /M9/);
});
test('número inválido falha nomeando a variável', () => {
  assert.throws(() => loadConfig({ env: { PORT: 'abc' } }), /PORT/);
  assert.throws(() => loadConfig({ env: { LLM_MAX_RETRIES: '-1' } }), /LLM_MAX_RETRIES/);
  assert.throws(() => loadConfig({ env: { SQL_TIMEOUT_MS: '0' } }), /SQL_TIMEOUT_MS/);
});
test('overrides vencem env', () => {
  assert.equal(loadConfig({ env: { PORT: '3000' }, overrides: { PORT: '4000' } }).server.port, 4000);
});

// Complementos (padrões do .env.example e campos dos erros tipados)
test('ENV-01 padrões do .env.example', () => {
  const c = loadConfig({ env: {} });
  assert.equal(c.llm.apiKey, null);
  assert.equal(c.llm.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(c.llm.model, 'openai/gpt-oss-120b');
  assert.equal(c.llm.fallbackModel, 'google/gemini-2.5-flash');
  assert.equal(c.llm.guardrailModel, 'openai/gpt-oss-safeguard-20b');
  assert.equal(c.llm.structuredMode, 'json_schema');
  assert.equal(c.llm.timeoutMs, 20000);
  assert.equal(c.llm.temperature, 0.2);
  assert.equal(c.llm.fakeChaos, 'none');
  assert.deepEqual(c.rag, { embedder: 'hash', topK: 3, minScore: MIN_SCORE_DEFAULTS['hash-v1'], chunkSize: 600, chunkOverlap: 100 });
  assert.deepEqual(c.sql, { maxCorrections: 3, maxRows: 200, rowsToLlm: 50, timeoutMs: 5000 });
  assert.deepEqual(c.paths, { appDb: 'data/app.db', salesDb: 'data/sales.db' });
  assert.deepEqual(c.server, { host: '127.0.0.1', port: 3000 });
  assert.equal(c.askTimeoutMs, 60000);
  assert.equal(c.logLevel, 'info');
});
test('LLM_PROVIDER=fake explícito vence a chave; GUARDRAIL_MODE explícito vence o padrão', () => {
  const c = loadConfig({ env: { LLM_PROVIDER: 'fake', OPENROUTER_API_KEY: 'sk-or-x', GUARDRAIL_MODE: 'off' } });
  assert.equal(c.llm.provider, 'fake');
  assert.equal(c.llm.apiKey, 'sk-or-x');
  assert.equal(c.guardrailMode, 'off');
});
test('valores fora do enum falham nomeando a variável', () => {
  assert.throws(() => loadConfig({ env: { LLM_PROVIDER: 'ollama' } }), (e: unknown) => e instanceof ConfigError && e.variable === 'LLM_PROVIDER');
  assert.throws(() => loadConfig({ env: { LLM_FAKE_CHAOS: 'boom' } }), /LLM_FAKE_CHAOS/);
  assert.throws(() => loadConfig({ env: { GUARDRAIL_MODE: 'model' } }), /GUARDRAIL_MODE/);
  assert.throws(() => loadConfig({ env: { LLM_TEMPERATURE: '3' } }), /LLM_TEMPERATURE/);
  assert.throws(() => loadConfig({ env: { RAG_MIN_SCORE: 'x' } }), /RAG_MIN_SCORE/);
});
test('RAG_MIN_SCORE explícito substitui o padrão calibrado', () => {
  assert.equal(loadConfig({ env: { RAG_MIN_SCORE: '0.42' } }).rag.minScore, 0.42);
});
test('ENV_KEYS lista as chaves do .env.example na ordem', () => {
  assert.deepEqual([...ENV_KEYS], ['LLM_PROVIDER', 'OPENROUTER_API_KEY', 'LLM_BASE_URL', 'OPENROUTER_MODEL',
    'OPENROUTER_MODEL_FALLBACK', 'GUARDRAIL_MODEL', 'LLM_STRUCTURED_MODE', 'LLM_TIMEOUT_MS', 'LLM_MAX_RETRIES',
    'LLM_MAX_CALLS_PER_REQUEST', 'LLM_TEMPERATURE', 'LLM_FAKE_CHAOS', 'EMBEDDER', 'RAG_TOP_K', 'RAG_MIN_SCORE',
    'RAG_CHUNK_SIZE', 'RAG_CHUNK_OVERLAP', 'SQL_MAX_CORRECTIONS', 'SQL_MAX_ROWS', 'SQL_ROWS_TO_LLM', 'SQL_TIMEOUT_MS', 'GUARDRAIL_MODE',
    'APP_DB_PATH', 'SALES_DB_PATH', 'HOST', 'PORT', 'ASK_TIMEOUT_MS', 'LOG_LEVEL']);
});
test('erros tipados carregam os campos declarados', () => {
  const f = new FixtureMissingError('router', 'v1', 'qual o prazo');
  assert.ok(f instanceof Error);
  assert.equal(f.name, 'FixtureMissingError');
  assert.deepEqual([f.promptId, f.version, f.key], ['router', 'v1', 'qual o prazo']);
  assert.match(f.message, /fixtures\/llm\/router\.v1\.json/);
  assert.equal(new BudgetExceededError(8).max, 8);
  assert.equal(new LlmError('timeout', 'x').kind, 'timeout');
});
