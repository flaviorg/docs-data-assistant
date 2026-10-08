// Erros tipados do domínio. Campos declarados no corpo da classe (type stripping proíbe parameter properties).
import type { AuthorizerDenial } from '../sql/readonly-connection.ts';

import type { LlmErrorKind } from '../llm/provider.ts';

// LlmErrorKind vive em src/llm/provider.ts (spec 001) e é reexportado daqui por conveniência.
export type { LlmErrorKind } from '../llm/provider.ts';

export class ConfigError extends Error {
  readonly variable: string;
  constructor(message: string, variable: string) {
    super(message);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

export class LlmUnavailableError extends Error {
  readonly lastKind: string;
  constructor(message: string, lastKind: string) {
    super(message);
    this.name = 'LlmUnavailableError';
    this.lastKind = lastKind;
  }
}

export class ParseError extends Error {
  // Discriminante para tratar `Result.error` (LlmError | ParseError) pelo campo `kind`.
  readonly kind: 'parse' = 'parse';
  readonly issues: string;
  constructor(message: string, issues: string) {
    super(message);
    this.name = 'ParseError';
    this.issues = issues;
  }
}

export class FixtureMissingError extends Error {
  readonly promptId: string;
  readonly version: string;
  readonly key: string;
  constructor(promptId: string, version: string, key: string) {
    super(`No fixture for prompt "${promptId}" (${version}) with key "${key}": add an entry to fixtures/llm/${promptId}.${version}.json`);
    this.name = 'FixtureMissingError';
    this.promptId = promptId;
    this.version = version;
    this.key = key;
  }
}

export class BudgetExceededError extends Error {
  readonly max: number;
  constructor(max: number) {
    super(`Cap of ${max} logical prompt executions per request reached`);
    this.name = 'BudgetExceededError';
    this.max = max;
  }
}

export class ReindexRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReindexRequiredError';
  }
}

export class SqlRuntimeError extends Error {
  readonly denials: AuthorizerDenial[];
  constructor(message: string, denials: AuthorizerDenial[]) {
    super(message);
    this.name = 'SqlRuntimeError';
    this.denials = denials;
  }
}

export class AskAbortedError extends Error {
  constructor() {
    super('The question was aborted before it finished');
    this.name = 'AskAbortedError';
  }
}

export class SqlTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`the query exceeded the ${timeoutMs} ms execution time limit and was stopped`);
    this.name = 'SqlTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
