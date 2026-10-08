// Página do assistente (WEB-01). Monta o DOM só com createElement e textContent: a página mostra trechos de
// documentos (inclusive o envenenado) e respostas do modelo, então nada vindo da API vira HTML.
// #cenario=<n> na URL roda o chip n ao carregar.
'use strict';

(() => {
  const STATUS_LABEL = { answered: 'respondida', refused: 'recusada', no_results: 'sem resultados', blocked: 'bloqueada', error: 'erro' };
  const ROUTE_LABEL = { docs: 'documentos', data: 'dados', out_of_scope: 'fora do escopo' };
  const BLOCKED_LABEL = {
    input_rules: 'regras de entrada', input_model: 'modelo de segurança', sql_policy: 'política SQL',
    sql_authorizer: 'authorizer do SQLite', output_guard: 'guarda de saída',
  };
  const TABLE_ROWS = 20;
  const nf = new Intl.NumberFormat('pt-BR');
  const usd = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 6 });

  const form = document.getElementById('ask-form');
  const input = document.getElementById('question');
  const button = document.getElementById('ask-button');
  const hint = document.getElementById('form-hint');
  const chips = document.getElementById('chips');
  const result = document.getElementById('result');
  const health = document.getElementById('health');
  const banner = document.getElementById('demo-banner');
  let busy = false;

  /** Cria um elemento com classe, texto e filhos. Texto sempre por textContent. */
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    const o = opts || {};
    if (o.className) node.className = o.className;
    if (o.text !== undefined && o.text !== null) node.textContent = String(o.text);
    if (o.title) node.title = o.title;
    if (o.type) node.type = o.type;
    for (const child of children || []) if (child) node.append(child);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function badge(text, kind) {
    return el('span', { className: `badge badge-${kind}`, text });
  }

  function section(title, children) {
    return el('section', { className: 'block' }, [el('h3', { text: title }), ...children]);
  }

  function setBusy(value) {
    busy = value;
    button.disabled = value;
    button.textContent = value ? 'Perguntando…' : 'Perguntar';
    result.setAttribute('aria-busy', value ? 'true' : 'false');
    for (const b of chips.querySelectorAll('button')) b.disabled = value;
  }

  /** Traz a resposta para a tela quando ela está fora da vista (no celular, os chips empurram a resposta para baixo). */
  function revealResult() {
    const rect = result.getBoundingClientRect();
    if (rect.top <= window.innerHeight * 0.6 && rect.bottom >= 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
    return res.json();
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (busy) return;
    if (q.length < 3 || q.length > 500) {
      hint.textContent = 'A pergunta precisa ter de 3 a 500 caracteres.';
      hint.className = 'form-hint form-hint-error';
      input.focus();
      return;
    }
    hint.textContent = 'De 3 a 500 caracteres.';
    hint.className = 'form-hint';
    input.value = q;
    setBusy(true);
    revealResult();
    clear(result);
    result.append(el('p', { className: 'placeholder', text: 'Consultando…' }));
    try {
      const res = await fetch('/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const body = await res.json();
      clear(result);
      if (res.ok) renderAnswer(body);
      else renderError(res.status, body);
    } catch (err) {
      clear(result);
      renderError(0, { error: 'network', message: `Não foi possível falar com o servidor: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  function renderAnswer(r) {
    const head = el('div', { className: 'result-head' }, [
      badge(r.route ? `rota: ${ROUTE_LABEL[r.route] || r.route}` : 'sem rota', 'route'),
      badge(STATUS_LABEL[r.status] || r.status, `status-${r.status}`),
      r.blockedBy ? badge(`bloqueio: ${BLOCKED_LABEL[r.blockedBy] || r.blockedBy}`, 'blocked') : null,
      r.overridden ? badge('rota forçada', 'route') : null,
    ]);
    result.append(head);
    if (r.routeReason) result.append(el('p', { className: 'route-reason', text: `Motivo da rota: ${r.routeReason}` }));
    result.append(el('p', { className: 'answer', text: r.answer }));

    if (r.guardrail && r.guardrail.verdict === 'unsafe' && r.guardrail.reasons.length > 0) {
      result.append(el('p', { className: 'muted', text: `Guardrail (${r.guardrail.layer}): ${r.guardrail.reasons.join(', ')}` }));
    }
    if (r.citations && r.citations.length > 0) result.append(renderCitations(r.citations));
    if (r.sql) result.append(renderSql(r.sql));
    if (r.followUpQuestions && r.followUpQuestions.length > 0) result.append(renderFollowUps(r.followUpQuestions));
    if (r.warnings && r.warnings.length > 0) {
      result.append(section('Avisos', [el('ul', { className: 'warnings' }, r.warnings.map((w) => el('li', { text: w })))]));
    }
    result.append(renderMeta(r));
  }

  function renderCitations(citations) {
    const list = el('ol', { className: 'sources' }, citations.map((c) => el('li', {}, [
      el('div', { className: 'source-head' }, [
        el('span', { className: 'source-title', text: `${c.docTitle} › ${c.heading}` }),
        el('span', { className: 'source-score', text: `score ${c.score.toFixed(3)}` }),
        c.sanitized ? badge('neutralizado', 'sanitized') : null,
      ]),
      el('p', { className: 'snippet', text: c.snippet }),
      el('p', { className: 'source-id', text: c.chunkId }),
    ])));
    return section('Fontes', [list]);
  }

  function renderSql(sql) {
    const parts = [];
    const corr = sql.corrections === 1 ? '1 correção' : `${sql.corrections} correções`;
    parts.push(el('p', { className: 'muted', text: `${corr}${sql.limitApplied ? ' · LIMIT aplicado' : ''}${sql.truncated ? ' · resultado cortado' : ''}` }));
    parts.push(el('pre', { className: 'code' }, [el('code', { text: sql.query })]));
    if (sql.originalQuery) {
      parts.push(el('details', { className: 'original' }, [
        el('summary', { text: 'Consulta original (antes das correções)' }),
        el('pre', { className: 'code' }, [el('code', { text: sql.originalQuery })]),
      ]));
    }
    if (sql.lastError) parts.push(el('p', { className: 'sql-error', text: `Último erro: ${sql.lastError}` }));
    if (sql.columns.length > 0 && sql.rows.length > 0) {
      const rows = sql.rows.slice(0, TABLE_ROWS);
      const table = el('table', {}, [
        el('thead', {}, [el('tr', {}, sql.columns.map((c) => el('th', { text: c })))]),
        el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell) => el('td', {
          className: typeof cell === 'number' ? 'num' : '',
          text: cell === null ? 'NULL' : typeof cell === 'number' ? nf.format(cell) : cell,
        }))))),
      ]);
      parts.push(el('div', { className: 'table-wrap' }, [table]));
      parts.push(el('p', { className: 'muted', text: `Mostrando ${rows.length} de ${sql.rowCount} linha(s).` }));
    }
    return section('SQL', parts);
  }

  function renderFollowUps(questions) {
    const list = el('ul', { className: 'followups' }, questions.map((q) => {
      const b = el('button', { type: 'button', className: 'link-button', text: q });
      b.addEventListener('click', () => ask(q));
      return el('li', {}, [b]);
    }));
    return section('Perguntas para continuar', [list]);
  }

  function renderMeta(r) {
    const m = r.meta;
    const tokens = m.tokens.prompt + m.tokens.completion;
    const cost = m.costUsd === null ? 'custo indisponível' : `US$ ${usd.format(m.costUsd)}${m.costIsFictional ? ' (fictício)' : ''}`;
    const facts = [
      `${m.llmCalls} chamada(s) ao LLM`,
      `${nf.format(tokens)} tokens${m.tokens.estimated ? ' (estimados)' : ''}`,
      cost,
      `${nf.format(Math.round(m.latencyMs))} ms`,
      m.models.length > 0 ? `modelos: ${m.models.join(', ')}` : 'nenhum modelo chamado',
    ];
    if (m.fallbackUsed) facts.push('fallback usado');
    return el('footer', { className: 'meta' }, [
      el('p', { text: facts.join(' · ') }),
      el('p', { className: 'trace', text: `nós: ${m.trace.map((t) => t.node).join(' → ')}` }),
      el('p', { className: 'trace', text: `provedor ${m.provider} · embedder ${m.embedder} · req ${r.requestId}` }),
    ]);
  }

  function renderError(status, body) {
    const b = body || {};
    result.append(el('div', { className: 'result-head' }, [badge(status ? `HTTP ${status}` : 'sem resposta', 'status-error'), badge(b.error || 'erro', 'blocked')]));
    result.append(el('p', { className: 'answer', text: b.message || 'Erro desconhecido.' }));
    if (Array.isArray(b.suggestions) && b.suggestions.length > 0) result.append(renderFollowUps(b.suggestions));
    if (b.requestId) result.append(el('p', { className: 'trace', text: `req ${b.requestId}` }));
  }

  function renderChips(questions) {
    clear(chips);
    for (const q of questions) {
      const expected = `${q.expected.route ? ROUTE_LABEL[q.expected.route] || q.expected.route : 'sem rota'} · ${STATUS_LABEL[q.expected.status] || q.expected.status}`;
      const b = el('button', { type: 'button', className: 'chip', title: q.question }, [
        el('span', { className: 'chip-id', text: String(q.id) }),
        el('span', { className: 'chip-label', text: q.label }),
        el('span', { className: 'chip-expected', text: `esperado: ${expected}` }),
      ]);
      b.dataset.scenario = String(q.id);
      b.addEventListener('click', () => ask(q.question));
      chips.append(el('li', {}, [b]));
    }
  }

  function runHashScenario(questions) {
    const m = /cenario=(\d+)/.exec(window.location.hash);
    if (!m) return;
    const q = questions.find((x) => x.id === Number(m[1]));
    if (q) ask(q.question);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask(input.value);
    }
  });

  getJson('/health').then((h) => {
    banner.hidden = h.provider !== 'fake';
    health.textContent = `provedor ${h.provider} · embedder ${h.embedder} · guardrail ${h.guardrail} · ${h.kb.documents} documentos, ${h.kb.chunks} trechos (${h.kb.flagged} neutralizado) · ${nf.format(h.sales.orders)} pedidos`;
  }).catch(() => {
    health.textContent = 'Não foi possível ler /health.';
  });

  getJson('/demo/questions').then((data) => {
    renderChips(data.questions);
    runHashScenario(data.questions);
    window.addEventListener('hashchange', () => runHashScenario(data.questions));
  }).catch(() => {
    chips.append(el('li', { className: 'muted', text: 'Não foi possível carregar os cenários.' }));
  });
})();
