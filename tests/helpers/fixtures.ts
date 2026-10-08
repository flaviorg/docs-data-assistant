// Fixtures reais do projeto (fixtures/llm) com responseFromGolden resolvido pelas perguntas-ouro.
import { goldenSqlResolver, loadGolden } from '../../src/eval/golden.ts';
import { loadFixtures } from '../../src/llm/fixtures.ts';
import type { FixtureIndex } from '../../src/llm/fixtures.ts';

export function loadRealFixtures(): FixtureIndex {
  return loadFixtures('fixtures/llm', { activeEmbedderId: 'hash-v1', resolveGoldenSql: goldenSqlResolver(loadGolden()) });
}
