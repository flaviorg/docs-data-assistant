// Página do assistente (WEB-01). Monta o DOM só com createElement e textContent: a página mostra trechos de
// documentos (inclusive o envenenado) e respostas do modelo, então nada vindo da API vira HTML.
// #scenario=<n> na URL roda o chip n ao carregar.
'use strict';

(() => {
  const STATUS_LABEL = { answered: 'answered', refused: 'refused', no_results: 'no results', blocked: 'blocked', error: 'error' };
  const ROUTE_LABEL = { docs: 'documents', data: 'data', out_of_scope: 'out of scope' };
  const BLOCKED_LABEL = {
    input_rules: 'input rules', input_model: 'safety model', sql_policy: 'SQL policy',
    sql_authorizer: 'SQLite authorizer', output_guard: 'output guard',
  };
  const TABLE_ROWS = 20;
  const nf = new Intl.NumberFormat('en-US');
  const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });

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
    button.textContent = value ? 'Asking…' : 'Ask';
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
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.json();
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (busy) return;
    if (q.length < 3 || q.length > 500) {
      hint.textContent = 'The question must have 3 to 500 characters.';
      hint.className = 'form-hint form-hint-error';
      input.focus();
      return;
    }
    hint.textContent = '3 to 500 characters.';
    hint.className = 'form-hint';
    input.value = q;
    setBusy(true);
    revealResult();
    clear(result);
    result.append(el('p', { className: 'placeholder', text: 'Looking it up…' }));
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
      renderError(0, { error: 'network', message: `Could not reach the server: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  function renderAnswer(r) {
    const head = el('div', { className: 'result-head' }, [
      badge(r.route ? `route: ${ROUTE_LABEL[r.route] || r.route}` : 'no route', 'route'),
      badge(STATUS_LABEL[r.status] || r.status, `status-${r.status}`),
      r.blockedBy ? badge(`blocked by: ${BLOCKED_LABEL[r.blockedBy] || r.blockedBy}`, 'blocked') : null,
      r.overridden ? badge('forced route', 'route') : null,
    ]);
    result.append(head);
    if (r.routeReason) result.append(el('p', { className: 'route-reason', text: `Route reason: ${r.routeReason}` }));
    result.append(el('p', { className: 'answer', text: r.answer }));

    if (r.guardrail && r.guardrail.verdict === 'unsafe' && r.guardrail.reasons.length > 0) {
      result.append(el('p', { className: 'muted', text: `Guardrail (${r.guardrail.layer}): ${r.guardrail.reasons.join(', ')}` }));
    }
    if (r.citations && r.citations.length > 0) result.append(renderCitations(r.citations));
    if (r.sql) result.append(renderSql(r.sql));
    if (r.followUpQuestions && r.followUpQuestions.length > 0) result.append(renderFollowUps(r.followUpQuestions));
    if (r.warnings && r.warnings.length > 0) {
      result.append(section('Warnings', [el('ul', { className: 'warnings' }, r.warnings.map((w) => el('li', { text: w })))]));
    }
    result.append(renderMeta(r));
  }

  function renderCitations(citations) {
    const list = el('ol', { className: 'sources' }, citations.map((c) => el('li', {}, [
      el('div', { className: 'source-head' }, [
        el('span', { className: 'source-title', text: `${c.docTitle} › ${c.heading}` }),
        el('span', { className: 'source-score', text: `score ${c.score.toFixed(3)}` }),
        c.sanitized ? badge('neutralized', 'sanitized') : null,
      ]),
      el('p', { className: 'snippet', text: c.snippet }),
      el('p', { className: 'source-id', text: c.chunkId }),
    ])));
    return section('Sources', [list]);
  }

  function renderSql(sql) {
    const parts = [];
    const corr = sql.corrections === 1 ? '1 correction' : `${sql.corrections} corrections`;
    parts.push(el('p', { className: 'muted', text: `${corr}${sql.limitApplied ? ' · LIMIT applied' : ''}${sql.truncated ? ' · result truncated' : ''}` }));
    parts.push(el('pre', { className: 'code' }, [el('code', { text: sql.query })]));
    if (sql.originalQuery) {
      parts.push(el('details', { className: 'original' }, [
        el('summary', { text: 'Original query (before the corrections)' }),
        el('pre', { className: 'code' }, [el('code', { text: sql.originalQuery })]),
      ]));
    }
    if (sql.lastError) parts.push(el('p', { className: 'sql-error', text: `Last error: ${sql.lastError}` }));
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
      parts.push(el('p', { className: 'muted', text: `Showing ${rows.length} of ${sql.rowCount} row(s).` }));
    }
    return section('SQL', parts);
  }

  function renderFollowUps(questions) {
    const list = el('ul', { className: 'followups' }, questions.map((q) => {
      const b = el('button', { type: 'button', className: 'link-button', text: q });
      b.addEventListener('click', () => ask(q));
      return el('li', {}, [b]);
    }));
    return section('Follow-up questions', [list]);
  }

  function renderMeta(r) {
    const m = r.meta;
    const tokens = m.tokens.prompt + m.tokens.completion;
    const cost = m.costUsd === null ? 'cost unavailable' : `US$ ${usd.format(m.costUsd)}${m.costIsFictional ? ' (fictional)' : ''}`;
    const facts = [
      `${m.llmCalls} LLM call(s)`,
      `${nf.format(tokens)} tokens${m.tokens.estimated ? ' (estimated)' : ''}`,
      cost,
      `${nf.format(Math.round(m.latencyMs))} ms`,
      m.models.length > 0 ? `models: ${m.models.join(', ')}` : 'no model called',
    ];
    if (m.fallbackUsed) facts.push('fallback used');
    return el('footer', { className: 'meta' }, [
      el('p', { text: facts.join(' · ') }),
      el('p', { className: 'trace', text: `nodes: ${m.trace.map((t) => t.node).join(' → ')}` }),
      el('p', { className: 'trace', text: `provider ${m.provider} · embedder ${m.embedder} · req ${r.requestId}` }),
    ]);
  }

  function renderError(status, body) {
    const b = body || {};
    result.append(el('div', { className: 'result-head' }, [badge(status ? `HTTP ${status}` : 'no response', 'status-error'), badge(b.error || 'error', 'blocked')]));
    result.append(el('p', { className: 'answer', text: b.message || 'Unknown error.' }));
    if (Array.isArray(b.suggestions) && b.suggestions.length > 0) result.append(renderFollowUps(b.suggestions));
    if (b.requestId) result.append(el('p', { className: 'trace', text: `req ${b.requestId}` }));
  }

  function renderChips(questions) {
    clear(chips);
    for (const q of questions) {
      const expected = `${q.expected.route ? ROUTE_LABEL[q.expected.route] || q.expected.route : 'no route'} · ${STATUS_LABEL[q.expected.status] || q.expected.status}`;
      const b = el('button', { type: 'button', className: 'chip', title: q.question }, [
        el('span', { className: 'chip-id', text: String(q.id) }),
        el('span', { className: 'chip-label', text: q.label }),
        el('span', { className: 'chip-expected', text: `expected: ${expected}` }),
      ]);
      b.dataset.scenario = String(q.id);
      b.addEventListener('click', () => ask(q.question));
      chips.append(el('li', {}, [b]));
    }
  }

  function runHashScenario(questions) {
    const m = /scenario=(\d+)/.exec(window.location.hash);
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
    health.textContent = `provider ${h.provider} · embedder ${h.embedder} · guardrail ${h.guardrail} · ${h.kb.documents} documents, ${h.kb.chunks} passages (${h.kb.flagged} neutralized) · ${nf.format(h.sales.orders)} orders`;
  }).catch(() => {
    health.textContent = 'Could not read /health.';
  });

  getJson('/demo/questions').then((data) => {
    renderChips(data.questions);
    runHashScenario(data.questions);
    window.addEventListener('hashchange', () => runHashScenario(data.questions));
  }).catch(() => {
    chips.append(el('li', { className: 'muted', text: 'Could not load the scenarios.' }));
  });
})();
