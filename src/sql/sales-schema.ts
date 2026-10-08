// Banco de vendas da Moenda Lunar (fictícia). DDL da spec 003, uma coluna por linha, valores em centavos.
// O texto é gravado como está em sqlite_master; a introspecção (schema-introspect.ts) remove as linhas
// das colunas negadas antes de mandar o schema ao modelo.

export const SALES_DDL = `CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                       -- dado pessoal: coluna NEGADA pelo authorizer e omitida do prompt
  city TEXT NOT NULL,
  state TEXT NOT NULL CHECK (length(state) = 2),
  segment TEXT NOT NULL CHECK (segment IN ('varejo', 'cafeteria')),
  created_at TEXT NOT NULL
);
CREATE TABLE customer_contacts (            -- dado pessoal: tabela FORA da allowlist
  customer_id INTEGER PRIMARY KEY REFERENCES customers(id),
  email TEXT NOT NULL,
  phone TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('graos', 'moido', 'capsulas', 'equipamentos', 'acessorios')),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  ordered_at TEXT NOT NULL,                 -- ISO 8601, horário de Brasília sem fuso
  channel TEXT NOT NULL CHECK (channel IN ('site', 'app', 'marketplace')),
  status TEXT NOT NULL CHECK (status IN ('pago', 'cancelado', 'reembolsado')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0)
);
CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  PRIMARY KEY (order_id, product_id)
);
`;

// Tabelas que a conexão analítica pode ler (authorizer) e que aparecem no prompt, nesta ordem.
export const SALES_ALLOWLIST = ['customers', 'products', 'orders', 'order_items'] as const;
export type SalesTable = (typeof SALES_ALLOWLIST)[number];

// Colunas negadas pelo authorizer e omitidas do schema enviado ao modelo (SQL-09).
export const DENIED_COLUMNS: Readonly<Record<string, readonly string[]>> = { customers: ['name'] };

// Glossário de negócio que acompanha o schema no prompt SQL (spec 003).
export const BUSINESS_GLOSSARY = `Glossário de negócio:
- Faturamento considera só pedidos com status = 'pago'.
- Valores monetários estão em centavos inteiros (price_cents, unit_price_cents, total_cents): divida por 100.0 para obter reais.
- "Semestre", "trimestre" e "mês" se referem a orders.ordered_at (texto ISO 8601, horário de Brasília sem fuso).
- Ticket médio é AVG(total_cents) dos pedidos pagos.
- Nomes de clientes não estão disponíveis: use cidade, estado ou segmento.
- Em customers, liste as colunas que a pergunta precisa: SELECT * ou c.* inclui a coluna de nome, negada pela política, e a consulta é bloqueada sem correção.`;
