// Servidor HTTP (spec 005): borda fina sobre o AskService. O requestId nasce no genReqId com a regra de OBS-02 e o
// hook onRequest o devolve em X-Request-Id em toda resposta, inclusive de erro. Erros do Fastify e rotas inexistentes
// saem com o corpo do contrato ({ error, message, requestId }), sem stack.
import fs from 'node:fs';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './app-context.ts';
import { DEMO_SCENARIOS } from './demo-scenarios.ts';
import { resolveRequestId } from './domain/request-id.ts';
import type { ErrorBody } from './domain/schemas.ts';
import { parseSince } from './obs/stats.ts';

export const BODY_LIMIT_BYTES = 16 * 1024;

// Spec 4.7: sem 'unsafe-inline'; só arquivos do próprio servidor.
export const CSP_HEADER = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const WEB_ASSETS = [
  { url: '/', file: 'index.html', type: 'text/html; charset=utf-8' },
  { url: '/app.js', file: 'app.js', type: 'text/javascript; charset=utf-8' },
  { url: '/app.css', file: 'app.css', type: 'text/css; charset=utf-8' },
] as const;

const FASTIFY_ERRORS: Readonly<Record<string, { status: number; error: string; message: string }>> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, error: 'bad_request', message: 'O corpo não é um JSON válido.' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, error: 'bad_request', message: 'O corpo está vazio; envie um JSON com o campo question.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, error: 'unsupported_media_type', message: 'Tipo de conteúdo não suportado; use application/json.' },
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, error: 'payload_too_large', message: `O corpo passou do limite de ${BODY_LIMIT_BYTES} bytes.` },
};

function sendError(req: FastifyRequest, reply: FastifyReply, status: number, error: string, message: string): FastifyReply {
  const body: ErrorBody = { error, message, requestId: req.id };
  return reply.status(status).type('application/json; charset=utf-8').send(body);
}

/** Pergunta de demonstração exposta aos chips da página: cenários 1 a 12 (o 13 depende do caos). */
export function demoQuestions() {
  return DEMO_SCENARIOS.filter((s) => s.id <= 12).map((s) => ({
    id: s.id, label: s.label, question: s.question, expected: { route: s.expected.route, status: s.expected.status },
  }));
}

export function createServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => resolveRequestId(req.headers['x-request-id']).id,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Request-Id', req.id);
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const known = err.code ? FASTIFY_ERRORS[err.code] : undefined;
    if (known) return sendError(req, reply, known.status, known.error, known.message);
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) return sendError(req, reply, status, 'bad_request', 'Requisição inválida.');
    ctx.logger.error('http_error', { requestId: req.id, error: err });
    return sendError(req, reply, 500, 'internal', 'Erro interno inesperado. O requestId identifica a ocorrência no log.');
  });

  app.setNotFoundHandler((req, reply) => sendError(req, reply, 404, 'not_found', `Rota inexistente: ${req.method} ${req.url.split('?')[0]}`));

  app.post('/ask', async (req, reply) => {
    const header = req.headers['x-request-id'];
    // header presente e trocado pelo genReqId: a resposta avisa request_id_replaced (OBS-02)
    const requestIdReplaced = header !== undefined && header !== req.id;
    const outcome = await ctx.askService.ask(req.body, { requestId: req.id, requestIdReplaced });
    if (outcome.ok) return reply.status(200).send(outcome.response);
    return reply.status(outcome.httpStatus).send(outcome.body);
  });

  app.get('/stats', async (req, reply) => {
    const raw = (req.query as Record<string, unknown>).since;
    const since = raw === undefined ? '24h' : String(raw);
    const ms = parseSince(since);
    if (ms === null) return sendError(req, reply, 400, 'bad_request', 'since deve ser 15m, 1h, 24h ou 7d.');
    return ctx.ledger.stats(ms);
  });

  app.get('/health', async () => {
    const m = ctx.models;
    const models = ctx.config.guardrailMode === 'rules+model' ? [m.primary, m.fallback, m.guardrail] : [m.primary, m.fallback];
    const orders = Number((ctx.sales.db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number | bigint }).n);
    return {
      ok: true,
      provider: ctx.provider.name,
      embedder: ctx.embedder.fingerprint,
      models,
      guardrail: ctx.config.guardrailMode,
      kb: ctx.store.counts(),
      sales: { orders },
    };
  });

  app.get('/demo/questions', async () => ({ questions: demoQuestions() }));

  // Página (WEB-01): os três arquivos são lidos uma vez, na criação do servidor.
  for (const asset of WEB_ASSETS) {
    const content = fs.readFileSync(new URL(`./web/${asset.file}`, import.meta.url), 'utf8');
    app.get(asset.url, async (_req, reply) => reply
      .header('Content-Security-Policy', CSP_HEADER)
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-cache')
      .type(asset.type)
      .send(content));
  }

  return app;
}
