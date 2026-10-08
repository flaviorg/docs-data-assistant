// Composição (spec 004): o único lugar que instancia stores, provider, client, classificadores e grafo.
// Modo file (padrão, npm start): data/sales.db e data/app.db via ensureData. Modo memory: seed e ingestão em
// :memory: (testes, demo e eval), sem gravar nada em disco.
import { DatabaseSync } from 'node:sqlite';
import { createAskService } from './ask-service.ts';
import type { AskService } from './ask-service.ts';
import type { AppConfig } from './config.ts';
import { DEMO_SCENARIOS } from './demo-scenarios.ts';
import { ensureData } from './ensure-data.ts';
import { ConfigError } from './domain/errors.ts';
import type { Embedder } from './embeddings/embedder.ts';
import { goldenSqlResolver, loadGolden } from './eval/golden.ts';
import { createAskGraph } from './graph/graph.ts';
import type { AskGraph } from './graph/graph.ts';
import { GUARDRAIL_POLICY } from './guardrails/classifier.ts';
import { createOutputGuard } from './guardrails/output-guard.ts';
import type { OutputGuard } from './guardrails/output-guard.ts';
import { createRuleClassifier } from './guardrails/rule-classifier.ts';
import { createSafeguardClassifier } from './guardrails/safeguard-classifier.ts';
import { createFakeProvider } from './llm/fake-provider.ts';
import { loadFixtures } from './llm/fixtures.ts';
import type { FixtureIndex } from './llm/fixtures.ts';
import { createLlmClient } from './llm/llm-client.ts';
import type { LlmClient } from './llm/llm-client.ts';
import { createOpenRouterProvider } from './llm/openrouter-provider.ts';
import { loadPrices } from './llm/pricing.ts';
import type { LlmProvider } from './llm/provider.ts';
import { createLedger } from './obs/ledger.ts';
import type { UsageLedger } from './obs/ledger.ts';
import { createLogger } from './obs/logger.ts';
import type { Logger } from './obs/logger.ts';
import { PROMPTS_V1 } from './prompts/v1/index.ts';
import { ragAnswerPrompt } from './prompts/v1/rag-answer.ts';
import { routerPrompt } from './prompts/v1/router.ts';
import { safeguardPrompt } from './prompts/v1/safeguard.ts';
import { sqlAnswerPrompt } from './prompts/v1/sql-answer.ts';
import { sqlCorrectPrompt } from './prompts/v1/sql-correct.ts';
import { sqlGeneratePrompt } from './prompts/v1/sql-generate.ts';
import { ingestKnowledgeBase, loadEmbedder } from './rag/ingest.ts';
import { createVectorStore } from './rag/vector-store.ts';
import type { KbStore, StoredChunk } from './rag/vector-store.ts';
import { createQueryRunner } from './sql/query-runner.ts';
import type { QueryRunner } from './sql/query-runner.ts';
import { openSalesConnection } from './sql/readonly-connection.ts';
import type { SalesConnection, SalesSource } from './sql/readonly-connection.ts';
import { describeSchema } from './sql/schema-introspect.ts';
import { createSalesSnapshot } from './sql/seed.ts';
import { createSqlValidator } from './sql/validator.ts';

export interface AppContext {
  config: AppConfig;
  provider: LlmProvider;
  fixtures: FixtureIndex | null;
  llm: LlmClient;
  models: { primary: string; fallback: string; guardrail: string };   // modelos efetivos do LlmClient
  ledger: UsageLedger;
  logger: Logger;
  store: KbStore;
  embedder: Embedder;
  sales: SalesConnection;          // validação (EXPLAIN QUERY PLAN) e SQL confiável do eval, na thread principal
  sqlRunner: QueryRunner;          // SQL gerada pelo modelo, num processo filho com prazo (SQL_TIMEOUT_MS)
  schemaText: string;
  outputGuard: OutputGuard;
  graph: AskGraph;
  askService: AskService;
  getChunk(id: string): StoredChunk | undefined;
  close(): void;
}

export interface AppContextOptions {
  dataMode?: 'file' | 'memory';
  provider?: LlmProvider;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  kbDir?: string;
  fixturesDir?: string;
  goldenFile?: string;
  logger?: Logger;          // padrão: logger JSON em stderr no nível do config
}

const FAKE_MODELS = { primary: 'fake/primary', fallback: 'fake/fallback', guardrail: 'fake/guardrail' } as const;
const EMBEDDER_ID = 'hash-v1';

function createProvider(config: AppConfig, fixtures: FixtureIndex | null): LlmProvider {
  if (config.llm.provider === 'fake') {
    if (!fixtures) throw new Error('provedor fake sem fixtures carregadas');
    return createFakeProvider({ fixtures, chaos: config.llm.fakeChaos });
  }
  if (!config.llm.apiKey) throw new ConfigError('OPENROUTER_API_KEY ausente: é obrigatória com LLM_PROVIDER=openrouter', 'OPENROUTER_API_KEY');
  return createOpenRouterProvider({ apiKey: config.llm.apiKey, baseUrl: config.llm.baseUrl, structuredMode: config.llm.structuredMode });
}

async function openData(config: AppConfig, opts: AppContextOptions, logger: Logger): Promise<{ appDb: DatabaseSync; store: KbStore; salesSource: SalesSource }> {
  const kbDir = opts.kbDir ?? 'data/kb';
  if ((opts.dataMode ?? 'file') === 'file') {
    // data/sales.db e data/app.db: semeia e reindexa o que faltar ou estiver desatualizado, depois abre.
    await ensureData(config, { kbDir, logger });
    const appDb = new DatabaseSync(config.paths.appDb);
    return { appDb, store: createVectorStore(appDb), salesSource: { kind: 'file', path: config.paths.salesDb } };
  }
  const appDb = new DatabaseSync(':memory:');
  const store = createVectorStore(appDb);
  await ingestKnowledgeBase({ store, kbDir, chunkSize: config.rag.chunkSize, chunkOverlap: config.rag.chunkOverlap });
  return { appDb, store, salesSource: { kind: 'snapshot', bytes: createSalesSnapshot() } };
}

export async function createAppContext(config: AppConfig, opts: AppContextOptions = {}): Promise<AppContext> {
  // Provider primeiro: a regra de composição falha antes de semear ou indexar qualquer coisa.
  const fixtures = config.llm.provider === 'fake'
    ? loadFixtures(opts.fixturesDir ?? 'fixtures/llm', {
        activeEmbedderId: EMBEDDER_ID,
        resolveGoldenSql: goldenSqlResolver(loadGolden(opts.goldenFile ?? 'eval/golden.v1.json')),
      })
    : null;
  const provider = opts.provider ?? createProvider(config, fixtures);
  if (config.guardrailMode === 'rules+model' && provider.name === 'fake') {
    throw new ConfigError('GUARDRAIL_MODE=rules+model exige um modelo de segurança real; com o provedor fake use GUARDRAIL_MODE=rules', 'GUARDRAIL_MODE');
  }

  const logger = opts.logger ?? createLogger({ level: config.logLevel });
  const { appDb, store, salesSource } = await openData(config, opts, logger);
  let embedder: Embedder;
  let schemaText: string;
  let sales: SalesConnection;
  try {
    embedder = loadEmbedder(store);
    // O schema vem de uma conexão sem authorizer (o authorizer nega sqlite_master); o assistente usa só a somente leitura.
    const admin = openSalesConnection(salesSource, { authorizer: false });
    try {
      schemaText = describeSchema(admin.db);
    } finally {
      admin.close();
    }
    sales = openSalesConnection(salesSource);
  } catch (err) {
    appDb.close();   // composição falhou (ex.: ReindexRequiredError): não deixa o app.db aberto
    throw err;
  }
  const ledger = createLedger(appDb, opts.now ? { now: opts.now } : {});

  const models = config.llm.provider === 'openrouter'
    ? { primary: config.llm.model, fallback: config.llm.fallbackModel, guardrail: config.llm.guardrailModel }
    : FAKE_MODELS;
  const llm = createLlmClient({
    provider, models, ledger, prices: loadPrices(),
    timeoutMs: config.llm.timeoutMs, maxRetries: config.llm.maxRetries, structuredMode: config.llm.structuredMode,
    ...(opts.sleep ? { sleep: opts.sleep } : {}), ...(opts.random ? { random: opts.random } : {}), ...(opts.now ? { now: opts.now } : {}),
  });
  const outputGuard = createOutputGuard({ prompts: PROMPTS_V1 });
  const getChunk = (id: string): StoredChunk | undefined => store.getChunk(id);
  const validator = createSqlValidator({ conn: sales, maxRows: config.sql.maxRows });
  // O processo filho só sobe na primeira consulta; contextos que não chegam ao ramo data não pagam por ele.
  const sqlRunner = createQueryRunner(salesSource, { timeoutMs: config.sql.timeoutMs });

  const graph = createAskGraph({
    guardrailInput: {
      rules: createRuleClassifier(),
      model: config.guardrailMode === 'rules+model' ? createSafeguardClassifier({ llm, prompt: safeguardPrompt }) : null,
      mode: config.guardrailMode,
      policy: GUARDRAIL_POLICY,
    },
    router: { llm, prompt: routerPrompt },
    retrieve: { embedder, store, topK: config.rag.topK, minScore: config.rag.minScore },
    ragAnswer: { llm, prompt: ragAnswerPrompt, getChunk },
    checkCitations: { outputGuard },
    sqlGenerate: { llm, prompt: sqlGeneratePrompt, schemaText },
    sqlValidate: { validator, maxCorrections: config.sql.maxCorrections },
    sqlCorrect: { llm, prompt: sqlCorrectPrompt, schemaText },
    sqlExecute: { runner: sqlRunner, maxRows: config.sql.maxRows, maxCorrections: config.sql.maxCorrections },
    sqlAnswer: { llm, prompt: sqlAnswerPrompt, rowsToLlm: config.sql.rowsToLlm },
    finalize: { outputGuard },
  });

  // Sugestões do 422 (modo fake): as perguntas dos chips (cenários 1 a 12; o 13 depende do caos).
  const suggestions = DEMO_SCENARIOS.filter((s) => s.id <= 12).map((s) => s.question);
  const askService = createAskService({
    graph, ledger, logger, config, providerName: provider.name, embedderFingerprint: embedder.fingerprint, getChunk,
    suggestions: () => [...suggestions], ...(opts.now ? { now: opts.now } : {}),
  });

  let closed = false;
  return {
    config, provider, fixtures, llm, models, ledger, logger, store, embedder, sales, sqlRunner, schemaText, outputGuard, graph, askService, getChunk,
    close() {
      if (closed) return;
      closed = true;
      sqlRunner.close();
      sales.close();
      appDb.close();
    },
  };
}
