# 2026-10-04: `Worker.terminate()` não interrompe uma consulta do `node:sqlite`

## Contexto

Correção do [produto cartesiano que travava o servidor](2026-10-04-produto-cartesiano-trava-o-servidor.md). O plano era o que o README já apontava como "o caminho certo": executar a SQL num `worker_threads.Worker` e chamar `terminate()` quando o prazo estourasse. Node 24.21.

## Sintoma

- Os testes do executor passaram, mas o processo de teste nunca saiu: ficou parado até ser morto com `SIGKILL` depois de 40 s.
- Numa sonda isolada, com o Worker rodando `SELECT COUNT(*) FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1`: depois de `terminate()`, a promessa devolvida nunca resolveu. O processo consumiu 1.992 ms de CPU nos 2 s seguintes (um núcleo inteiro), e nem `process.exit(0)` conseguiu encerrá-lo.

## Causa

`terminate()` pede ao V8 que interrompa a execução de JavaScript da thread. A thread estava dentro de `sqlite3_step`, em código nativo, e só voltaria ao JavaScript ao fim da consulta. O SQLite tem `sqlite3_interrupt` e *progress handler* para isso, mas o `node:sqlite` desta versão não expõe nenhum dos dois. Conferi os métodos de `DatabaseSync.prototype`: `open`, `close`, `prepare`, `exec`, `function`, `createTagStore`, `location`, `aggregate`, `createSession`, `applyChangeset`, `enableLoadExtension`, `enableDefensive`, `loadExtension`, `serialize`, `deserialize` e `setAuthorizer`. Enquanto a thread não sai do código nativo, o processo não termina.

## Correção

- A SQL roda num **processo filho** (`child_process.fork`, serialização `advanced` para levar o snapshot do banco). No prazo, ou no abort da requisição, o pai manda `SIGKILL`: o sistema operacional encerra o processo na hora, qualquer que seja o código em execução. Na sonda, o filho morreu 2 ms depois do sinal.
- O filho é criado na primeira consulta (uns 40 ms) e reaproveitado. Os pedidos rodam um por vez, em fila. Quando está ocioso, o filho não segura o processo pai (`unref` no processo e no canal IPC).
- **Órfão ocupado:** se o pai morrer enquanto o filho está preso numa consulta, ninguém manda o `SIGKILL`. Uma thread de vigia no filho confere o `process.ppid` a cada 250 ms e encerra o processo se o pai mudou. Na sonda, com o pai saindo por `process.exit(0)` ou recebendo `SIGTERM` no meio da consulta, o filho sumiu em menos de 1 s. Ocioso, o filho sai sozinho no `disconnect` do canal.
- O filho recebe `execArgv: []`, para não herdar `--inspect`, `--watch` nem as opções que o `node --test` repassa. O ambiente vem por `process.env`, inclusive o `NODE_OPTIONS` com o bloqueio de rede dos testes.

## Teste que impede a volta

- `tests/unit/query-runner.unit.test.ts`: a consulta pesada termina em `SqlTimeoutError` dentro do prazo, o event loop do pai segue rodando e a consulta seguinte funciona num filho novo. O arquivo de teste sai sozinho; com o Worker, ele ficava preso.
- A suíte inteira (`npm test`) termina sem deixar processo `query-process.ts` vivo (conferido com `ps` depois da execução).
