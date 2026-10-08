// npm start: lê a configuração, garante os dados em disco (modo file: data/sales.db e data/app.db), sobe o Fastify
// e encerra com limpeza em SIGINT ou SIGTERM. Logs em stderr, JSON de uma linha.
import { createAppContext } from './app-context.ts';
import type { AppContext } from './app-context.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './obs/logger.ts';
import { createServer } from './server.ts';

async function main(): Promise<number> {
  const bootLogger = createLogger({ level: 'info' });
  let ctx: AppContext | null = null;
  try {
    const config = loadConfig();
    ctx = await createAppContext(config, { dataMode: 'file' });
    const app = createServer(ctx);
    const url = await app.listen({ host: config.server.host, port: config.server.port });
    ctx.logger.info('server_started', {
      url, provider: ctx.provider.name, embedder: ctx.embedder.fingerprint, guardrail: config.guardrailMode,
      models: [ctx.models.primary, ctx.models.fallback], kb: ctx.store.counts(),
    });
    if (ctx.provider.name === 'fake') {
      ctx.logger.info('demo_mode', { message: 'DEMO MODE: scripted model answers (fake). Set OPENROUTER_API_KEY to use a real model.' });
    }
    const opened = ctx;
    let closing = false;
    const shutdown = (signal: string) => {
      if (closing) return;
      closing = true;
      opened.logger.info('server_stopping', { signal });
      app.close().finally(() => opened.close());
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    return 0;
  } catch (err) {
    bootLogger.error('server_start_failed', { error: err instanceof Error ? { name: err.name, message: err.message } : String(err) });
    ctx?.close();
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  if (code !== 0) process.exitCode = code;
}
