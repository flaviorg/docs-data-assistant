// Carregado com `node --import ./tests/helpers/no-network.ts` (ENV-03).
// Bloqueia qualquer conexão de rede durante `npm test` e se propaga aos processos filhos
// por NODE_OPTIONS. Conexões por pipe (socket de domínio Unix) continuam permitidas.
import net from 'node:net';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

const MARK = Symbol.for('docs-data-assistant.no-network');
const globalState = globalThis as unknown as Record<symbol, boolean | undefined>;

function blocked(what: string): Error {
  return new Error(`NETWORK_BLOCKED: ${what} em npm test`);
}

function isPipeTarget(first: unknown): boolean {
  // net.connect() normaliza os argumentos num array [options, cb] antes de chamar Socket#connect.
  const target = Array.isArray(first) ? first[0] : first;
  if (typeof target === 'string') return !/^\d+$/.test(target);
  if (target !== null && typeof target === 'object') {
    const path = (target as { path?: unknown }).path;
    return typeof path === 'string' && path.length > 0;
  }
  return false;
}

if (!globalState[MARK]) {
  globalState[MARK] = true;

  const originalConnect = net.Socket.prototype.connect;
  const guardedConnect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    if (!isPipeTarget(args[0])) throw blocked('conexão TCP');
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  };
  net.Socket.prototype.connect = guardedConnect as typeof net.Socket.prototype.connect;

  globalThis.fetch = (async () => {
    throw blocked('fetch');
  }) as typeof fetch;

  const blockedLookup = (): never => {
    throw blocked('dns.lookup');
  };
  dns.lookup = blockedLookup as unknown as typeof dns.lookup;
  dns.promises.lookup = (async () => {
    throw blocked('dns.promises.lookup');
  }) as typeof dns.promises.lookup;
  syncBuiltinESMExports();

  const flag = `--import=${import.meta.url}`;
  const current = process.env.NODE_OPTIONS ?? '';
  if (!current.split(/\s+/).includes(flag)) {
    process.env.NODE_OPTIONS = current ? `${current} ${flag}` : flag;
  }
}
