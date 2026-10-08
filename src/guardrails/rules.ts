// Regras de injeção (PT e EN) com id e severidade (spec 004). Casam sobre o texto normalizado
// (sem acento, minúsculas, só [a-z0-9 ]) ou, quando a pontuação importa, sobre o texto cru dobrado.
import { normalizeText } from '../domain/normalize.ts';

export interface Rule {
  id: string;
  severity: 'high' | 'medium';
  scopes: readonly ('input' | 'document')[];
  test(normalized: string, raw: string): boolean;
}

const BOTH = ['input', 'document'] as const;
const DOC = ['document'] as const;

/** Texto cru sem acento e em minúsculas, mas com a pontuação preservada. */
const fold = (raw: string): string => raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const REVEAL_VERBS = 'mostre|mostrar|mostra|revele|revelar|revela|exiba|exibir|imprima|imprimir|repita|repetir|diga|dizer|conte|contar|copie|copiar|vaze|vazar|liste|listar|informe|informar|escreva|escrever|transcreva|compartilhe|envie|show|reveal|print|repeat|display|tell|output|leak|dump|share|give';
const PROMPT_TARGETS = '(?:prompt|mensagem|instrucoes|instrucao|configuracao|regras)(?: de| do| da)? (?:sistema|system|inicial|iniciais|original|originais|oculto|ocultas|ocultos|secreto|secretas|secretos)|system prompt|system message|hidden instructions|initial instructions|original instructions|instructions above';

export const RULES: readonly Rule[] = [
  {
    id: 'instruction_override', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:ignore|ignora|ignorem|ignorar|desconsidere|desconsidera|desconsiderar|esqueca|esquece|esquecer|despreze|desprezar|descarte|descartar)(?: \w+){0,4} (?:instrucoes|instrucao|regras|orientacoes|comandos|diretrizes|ordens)\b/.test(n)
      || /\b(?:ignore|disregard|forget|override)(?: \w+){0,4} (?:instructions?|rules|prompts?|directions|guidelines)\b/.test(n),
  },
  {
    id: 'reveal_system_prompt', severity: 'high', scopes: BOTH,
    test: (n) => new RegExp(`\\b(?:${REVEAL_VERBS})(?: \\w+){0,5} (?:${PROMPT_TARGETS})\\b`).test(n)
      || /\b(?:seu|teu|your) (?:prompt|system prompt)\b/.test(n),
  },
  {
    id: 'developer_mode', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:modo (?:desenvolvedor|developer|dev|deus|irrestrito|admin|administrador|debug|sem restricoes)|developer mode|god mode|dan mode|jailbreak|do anything now)\b/.test(n),
  },
  {
    id: 'role_hijack', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:voce agora e|agora voce e|a partir de agora voce|finja (?:ser|que e|que voce e)|fingir ser|assuma o papel|you are now|from now on you|pretend (?:to be|you are)|assume the role|roleplay as)\b/.test(n),
  },
  {
    // <documento> é o delimitador dos trechos no prompt rag-answer: uma pergunta que o fecha ou abre forjaria um trecho.
    id: 'system_tag', severity: 'high', scopes: BOTH,
    test: (_n, raw) => /<\s*\/?\s*(?:system|sistema|assistant|developer|instructions?|instrucoes|im_start|im_end|documento|document)\b[^>]*>/i.test(fold(raw))
      || /<\|im_(?:start|end)\|>|\[\/?(?:system|inst)\]/i.test(raw),
  },
  {
    id: 'base64_blob', severity: 'high', scopes: BOTH,
    test: (_n, raw) => (raw.match(/[A-Za-z0-9+/]{60,}={0,2}/g) ?? []).some((b) => /[A-Z]/.test(b) && /[a-z]/.test(b)),
  },
  {
    id: 'automated_systems_note', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:nota|aviso|mensagem|recado|instrucao|instrucoes|atencao) (?:para|aos|ao|as|a) (?:os |as )?(?:sistemas?|assistentes?|ias?|modelos?|robos?|bots?|agentes?|llms?|inteligencias? artificia(?:l|is))(?: automatizados?| automaticos?| de ia| de linguagem| virtua(?:l|is))?\b/.test(n)
      || /\b(?:note|message|instructions?) (?:to|for) (?:all )?(?:ai|automated systems?|assistants?|ai assistants?|language models?|llms?|bots?|agents?)\b/.test(n),
  },
  {
    id: 'assistant_address', severity: 'high', scopes: DOC,
    test: (_n, raw) => /(?:^|[.!?\n]\s*)(?:(?:atencao|aviso|ola|oi|caro|cara|prezado|prezada|hey|dear|attention)\s*,?\s*)?(?:assistente(?: de ia| virtual| automatico)?|modelo de (?:ia|linguagem)|chatbot|ai assistant|assistant|language model|llm|ia)\s*[,:]/.test(fold(raw).trim()),
  },
  {
    id: 'new_instructions', severity: 'high', scopes: BOTH,
    test: (_n, raw) => /\b(?:novas instrucoes|nova instrucao|new instructions|updated instructions)\s*:/.test(fold(raw)),
  },
  {
    id: 'obey_document', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:siga|obedeca|execute|cumpra|follow|obey)(?: \w+){0,3} (?:instrucoes|ordens|comandos|instructions|commands) (?:abaixo|a seguir|deste documento|deste texto|contidas aqui|below|in this document)\b/.test(n),
  },
  {
    id: 'secrets_exfiltration', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:mostre|revele|imprima|liste|informe|diga|envie|show|print|reveal|give me|tell me)(?: \w+){0,4} (?:chaves? de api|api keys?|tokens? de acesso|access tokens?|senha do sistema|variaveis de ambiente|environment variables|credenciais|credentials)\b/.test(n),
  },
  {
    id: 'disable_guardrails', severity: 'high', scopes: BOTH,
    test: (n) => /\b(?:desative|desativar|desligue|desligar|desabilite|desabilitar|remova|remover|disable|turn off|remove|bypass)(?: \w+){0,3} (?:guardrails?|filtros de (?:seguranca|conteudo)|protecoes|restricoes|moderacao|safety|content filters?|safety filters?|moderation)\b/.test(n),
  },
  {
    id: 'html_script', severity: 'high', scopes: BOTH,
    test: (_n, raw) => /<\s*script\b|javascript\s*:|\bon(?:error|load)\s*=/i.test(raw),
  },
  {
    id: 'discount_coupon_injection', severity: 'medium', scopes: BOTH,
    test: (n) => /\b(?:cupom|cupons|coupons?|voucher|codigo promocional|codigo de desconto)\b/.test(n)
      && /\b(?:100|cem) (?:por cento |percent |porcento )?(?:de )?(?:desconto|off)\b|\bdesconto (?:total|integral)\b|\b(?:gratis|de graca|gratuito|free)\b/.test(n),
  },
  {
    id: 'policy_bypass', severity: 'medium', scopes: BOTH,
    test: (n) => /\b(?:sem (?:restricoes|restricao|limites|filtros?|censura|regras)|without (?:restrictions|filters|limits|rules)|no (?:restrictions|filters|rules)|uncensored|unfiltered|burlar|burle|contornar|contorne|bypass)\b/.test(n),
  },
  {
    id: 'hypothetical_framing', severity: 'medium', scopes: BOTH,
    test: (n) => /\b(?:hipoteticamente|hypothetically|para fins educacionais|for educational purposes|so de brincadeira|imagine que voce|imagine you are)\b/.test(n),
  },
  {
    id: 'role_prefix', severity: 'medium', scopes: BOTH,
    test: (_n, raw) => /(?:^|\n)\s*(?:system|sistema|developer|assistant|assistente)\s*:/.test(fold(raw)),
  },
  {
    id: 'context_reset', severity: 'medium', scopes: BOTH,
    test: (n) => /\b(?:esqueca tudo|esqueca o que|apague sua memoria|forget everything|forget all|reset your (?:context|memory))\b/.test(n),
  },
  {
    id: 'repeat_after_me', severity: 'medium', scopes: BOTH,
    test: (n) => /\b(?:repita apos mim|repita comigo|repeat after me)\b/.test(n),
  },
  {
    id: 'markdown_image_exfil', severity: 'medium', scopes: BOTH,
    test: (_n, raw) => /!\[[^\]]*\]\(\s*https?:/i.test(raw),
  },
];

/** Bloqueia com uma regra `high` ou com duas `medium`. */
export function matchRules(text: string, scope: 'input' | 'document'): { blocked: boolean; matches: { id: string; severity: 'high' | 'medium' }[] } {
  const normalized = normalizeText(text);
  const matches = RULES.filter((r) => r.scopes.includes(scope) && r.test(normalized, text)).map((r) => ({ id: r.id, severity: r.severity }));
  const highs = matches.filter((m) => m.severity === 'high').length;
  const mediums = matches.length - highs;
  return { blocked: highs > 0 || mediums >= 2, matches };
}
