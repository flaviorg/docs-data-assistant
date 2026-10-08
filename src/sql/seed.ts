// Seed determinístico do banco de vendas da Moenda Lunar (DATA-01).
// Todos os nomes, cidades e produtos abaixo são listas fictícias escritas para este projeto.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mulberry32 } from './prng.ts';
import { SALES_DDL } from './sales-schema.ts';

export const DEFAULT_SEED = 20251;

export interface SeedReport {
  counts: { customers: number; contacts: number; products: number; orders: number; orderItems: number };
  fingerprint: string;
}

type Category = 'graos' | 'moido' | 'capsulas' | 'equipamentos' | 'acessorios';
type Segment = 'varejo' | 'cafeteria';
type Channel = 'site' | 'app' | 'marketplace';
type OrderStatus = 'pago' | 'cancelado' | 'reembolsado';

const VOLUME = { customers: 300, cafeteriaShare: 0.15, orders: 4000, paid: 0.90, cancelled: 0.06 } as const;

const FIRST_NAMES = [
  'Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'João',
  'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Pedro', 'Rafaela', 'Samuel', 'Tatiane', 'Vinícius',
  'Yasmin', 'André', 'Beatriz', 'Caio', 'Débora', 'Fernando', 'Helena', 'Igor', 'Larissa', 'Mateus',
];
const LAST_NAMES = [
  'Almeida', 'Barbosa', 'Cardoso', 'Dias', 'Esteves', 'Ferreira', 'Gomes', 'Henriques', 'Isidoro', 'Jardim',
  'Lacerda', 'Macedo', 'Nogueira', 'Oliveira', 'Pacheco', 'Queiroz', 'Ramos', 'Siqueira', 'Teixeira', 'Uchoa',
  'Vasconcelos', 'Xavier', 'Zanetti', 'Amaral', 'Brandão', 'Coelho', 'Duarte', 'Freitas', 'Moura', 'Pires',
];

// [cidade, UF, DDD, peso]
const CITIES: readonly (readonly [string, string, string, number])[] = [
  ['São Paulo', 'SP', '11', 5], ['Campinas', 'SP', '19', 2], ['Santos', 'SP', '13', 1],
  ['Rio de Janeiro', 'RJ', '21', 4], ['Niterói', 'RJ', '21', 1], ['Belo Horizonte', 'MG', '31', 3],
  ['Juiz de Fora', 'MG', '32', 1], ['Uberlândia', 'MG', '34', 1], ['Curitiba', 'PR', '41', 3],
  ['Londrina', 'PR', '43', 1], ['Florianópolis', 'SC', '48', 2], ['Joinville', 'SC', '47', 1],
  ['Porto Alegre', 'RS', '51', 2], ['Caxias do Sul', 'RS', '54', 1], ['Salvador', 'BA', '71', 2],
  ['Recife', 'PE', '81', 2], ['Fortaleza', 'CE', '85', 1], ['Brasília', 'DF', '61', 2],
  ['Goiânia', 'GO', '62', 1], ['Vitória', 'ES', '27', 1],
];

// [sku, nome, categoria, preço em centavos, ativo]
const PRODUCTS: readonly (readonly [string, string, Category, number, 0 | 1])[] = [
  ['GR-001', 'Grão Serra Azul 250 g', 'graos', 4290, 1],
  ['GR-002', 'Grão Serra Azul 1 kg', 'graos', 14990, 1],
  ['GR-003', 'Grão Vale da Neblina 250 g', 'graos', 4790, 1],
  ['GR-004', 'Grão Vale da Neblina 1 kg', 'graos', 16490, 1],
  ['GR-005', 'Grão Pico do Luar 250 g', 'graos', 5490, 1],
  ['GR-006', 'Grão Pico do Luar 1 kg', 'graos', 18990, 1],
  ['GR-007', 'Grão Cerrado Estrelado 250 g', 'graos', 3990, 1],
  ['GR-008', 'Grão Cerrado Estrelado 1 kg', 'graos', 13490, 1],
  ['GR-009', 'Grão Encosta Clara Natural 250 g', 'graos', 6290, 1],
  ['GR-010', 'Grão Ribeirão Manso Fermentado 250 g', 'graos', 7490, 1],
  ['GR-011', 'Grão Campo Dourado Descafeinado 250 g', 'graos', 4990, 1],
  ['GR-012', 'Grão Microlote Lua Nova 200 g', 'graos', 8990, 0],
  ['MO-001', 'Moído Serra Azul 250 g', 'moido', 4390, 1],
  ['MO-002', 'Moído Serra Azul 500 g', 'moido', 7990, 1],
  ['MO-003', 'Moído Vale da Neblina 250 g', 'moido', 4890, 1],
  ['MO-004', 'Moído Cerrado Estrelado 250 g', 'moido', 3990, 1],
  ['MO-005', 'Moído Cerrado Estrelado 500 g', 'moido', 7290, 1],
  ['MO-006', 'Moído Pico do Luar 250 g', 'moido', 5590, 1],
  ['MO-007', 'Moído Campo Dourado Descafeinado 250 g', 'moido', 5090, 1],
  ['MO-008', 'Moído para Coado Planalto Sereno 500 g', 'moido', 6990, 1],
  ['MO-009', 'Moído Fino para Espresso Encosta Clara 250 g', 'moido', 5990, 1],
  ['MO-010', 'Moído Blend da Casa 1 kg', 'moido', 12990, 1],
  ['CA-001', 'Cápsulas Serra Azul (10 un.)', 'capsulas', 2290, 1],
  ['CA-002', 'Cápsulas Vale da Neblina (10 un.)', 'capsulas', 2490, 1],
  ['CA-003', 'Cápsulas Pico do Luar Intenso (10 un.)', 'capsulas', 2690, 1],
  ['CA-004', 'Cápsulas Cerrado Estrelado (10 un.)', 'capsulas', 1990, 1],
  ['CA-005', 'Cápsulas Descafeinado Campo Dourado (10 un.)', 'capsulas', 2390, 1],
  ['CA-006', 'Cápsulas Lungo Planalto Sereno (10 un.)', 'capsulas', 2290, 1],
  ['CA-007', 'Cápsulas Sortidas (30 un.)', 'capsulas', 6490, 1],
  ['CA-008', 'Cápsulas Edição Inverno (10 un.)', 'capsulas', 2890, 0],
  ['EQ-001', 'Moedor Manual Órbita', 'equipamentos', 28900, 1],
  ['EQ-002', 'Moedor Elétrico Órbita Pro', 'equipamentos', 74900, 1],
  ['EQ-003', 'Prensa Francesa Crescente 600 ml', 'equipamentos', 18900, 1],
  ['EQ-004', 'Cafeteira Italiana Eclipse 6 xícaras', 'equipamentos', 15900, 1],
  ['EQ-005', 'Máquina de Espresso Lunar', 'equipamentos', 249000, 1],
  ['AC-001', 'Filtro de Papel nº 103 (100 un.)', 'acessorios', 1890, 1],
  ['AC-002', 'Balança Digital com Timer', 'acessorios', 13900, 1],
  ['AC-003', 'Chaleira Bico de Ganso 1 L', 'acessorios', 21900, 1],
  ['AC-004', 'Caneca de Cerâmica Fase da Lua', 'acessorios', 5900, 1],
  ['AC-005', 'Porta-filtro de Cerâmica', 'acessorios', 8900, 0],
];

// Pico no 4º trimestre (Black Friday e fim de ano).
const MONTH_WEIGHTS = [7, 6.5, 7, 7, 7.5, 7.5, 8, 8, 8.5, 10, 12, 13];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const CATEGORY_WEIGHTS: Record<Segment, Record<Category, number>> = {
  varejo: { graos: 3, moido: 3, capsulas: 3, equipamentos: 0.4, acessorios: 1 },
  cafeteria: { graos: 6, moido: 2, capsulas: 0.5, equipamentos: 0.3, acessorios: 0.6 },
};
const CHANNEL_WEIGHTS: Record<Segment, readonly (readonly [Channel, number])[]> = {
  varejo: [['site', 45], ['app', 33], ['marketplace', 22]],
  cafeteria: [['site', 80], ['app', 20]],
};
const ITEMS_PER_ORDER: readonly (readonly [number, number])[] = [[1, 30], [2, 30], [3, 25], [4, 15]];
const CAFETERIA_DISCOUNT = 0.88; // preço de atacado em grãos e moídos
const DISCONTINUED_AFTER = '2025-07-01'; // produtos inativos só aparecem no 1º semestre

type Rng = () => number;

function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function slug(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function randomDate2025(rng: Rng, weights: readonly number[]): { month: number; day: number } {
  const month = pickWeighted(rng, weights.map((w, i) => [i + 1, w] as const));
  const day = 1 + Math.floor(rng() * MONTH_DAYS[month - 1]!);
  return { month, day };
}

interface CustomerRow { id: number; name: string; city: string; state: string; ddd: string; segment: Segment; createdAt: string }
interface ProductRow { id: number; sku: string; name: string; category: Category; price: number; active: 0 | 1; popularity: number }

function buildCustomers(rng: Rng): CustomerRow[] {
  // Datas de cadastro em 2025: 40% em janeiro (base inicial), o resto ao longo do ano.
  const dates: string[] = [];
  for (let i = 0; i < VOLUME.customers; i++) {
    const { month, day } = rng() < 0.4 ? { month: 1, day: 1 + Math.floor(rng() * 31) } : randomDate2025(rng, MONTH_WEIGHTS);
    dates.push(`2025-${pad(month)}-${pad(day)}`);
  }
  dates.sort();
  dates[0] = '2025-01-01'; // há cliente desde o primeiro dia de pedidos
  const cafeterias = new Set(shuffle(rng, Array.from({ length: VOLUME.customers }, (_, i) => i))
    .slice(0, Math.round(VOLUME.customers * VOLUME.cafeteriaShare)));
  const cityItems = CITIES.map((c) => [c, c[3]] as const);
  return dates.map((createdAt, i) => {
    const [city, state, ddd] = pickWeighted(rng, cityItems);
    const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
    const last = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
    return { id: i + 1, name: `${first} ${last}`, city, state, ddd, segment: cafeterias.has(i) ? 'cafeteria' : 'varejo', createdAt };
  });
}

function buildProducts(rng: Rng): ProductRow[] {
  return PRODUCTS.map(([sku, name, category, price, active], i) => ({
    id: i + 1, sku, name, category, price, active, popularity: 1 + Math.floor(rng() * 4),
  }));
}

function quantityFor(rng: Rng, segment: Segment, category: Category): number {
  if (category === 'equipamentos') return 1;
  if (segment === 'cafeteria') return category === 'acessorios' ? 1 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 7);
  return pickWeighted(rng, [[1, 60], [2, 30], [3, 10]]);
}

/** Cria o schema e popula o banco com dados fictícios determinísticos, numa transação. */
export function seedSales(db: DatabaseSync, opts: { seed?: number } = {}): SeedReport {
  const rng = mulberry32(opts.seed ?? DEFAULT_SEED);
  const customers = buildCustomers(rng);
  const products = buildProducts(rng);

  // Pedidos: datas sorteadas e ordenadas, para que o id siga a ordem cronológica.
  const stamps: string[] = [];
  for (let i = 0; i < VOLUME.orders; i++) {
    const { month, day } = randomDate2025(rng, MONTH_WEIGHTS);
    const h = 7 + Math.floor(rng() * 17);
    const m = Math.floor(rng() * 60);
    const s = Math.floor(rng() * 60);
    stamps.push(`2025-${pad(month)}-${pad(day)}T${pad(h)}:${pad(m)}:${pad(s)}`);
  }
  stamps.sort();
  const paid = Math.round(VOLUME.orders * VOLUME.paid);
  const cancelled = Math.round(VOLUME.orders * VOLUME.cancelled);
  const statuses = shuffle(rng, Array.from({ length: VOLUME.orders }, (_, i): OrderStatus =>
    (i < paid ? 'pago' : i < paid + cancelled ? 'cancelado' : 'reembolsado')));

  // Clientes elegíveis numa data: prefixo da lista ordenada por cadastro. Cafeterias compram mais.
  const prefix: number[] = [0];
  for (const c of customers) prefix.push(prefix[prefix.length - 1]! + (c.segment === 'cafeteria' ? 2.5 : 1));
  const eligibleCount = (date: string) => {
    let lo = 0;
    let hi = customers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (customers[mid]!.createdAt <= date) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const pickCustomer = (date: string): CustomerRow => {
    const k = eligibleCount(date);
    const r = rng() * prefix[k]!;
    let lo = 0;
    let hi = k - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid + 1]! > r) hi = mid; else lo = mid + 1;
    }
    return customers[lo]!;
  };

  db.exec('BEGIN');
  try {
    db.exec(SALES_DDL);
    const insCustomer = db.prepare('INSERT INTO customers (id, name, city, state, segment, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insContact = db.prepare('INSERT INTO customer_contacts (customer_id, email, phone) VALUES (?, ?, ?)');
    for (const c of customers) {
      insCustomer.run(c.id, c.name, c.city, c.state, c.segment, c.createdAt);
      const [first, ...rest] = c.name.split(' ');
      // Telefone começando por 0000: não existe número de assinante assim no Brasil.
      insContact.run(c.id, `${slug(first ?? 'cliente')}.${slug(rest.join(''))}.${c.id}@email.example`, `(${c.ddd}) 0000-${pad(c.id, 4)}`);
    }
    const insProduct = db.prepare('INSERT INTO products (id, sku, name, category, price_cents, active) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of products) insProduct.run(p.id, p.sku, p.name, p.category, p.price, p.active);

    const insOrder = db.prepare('INSERT INTO orders (id, customer_id, ordered_at, channel, status, total_cents) VALUES (?, ?, ?, ?, ?, ?)');
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)');
    stamps.forEach((orderedAt, i) => {
      const orderId = i + 1;
      const customer = pickCustomer(orderedAt.slice(0, 10));
      const available = products.filter((p) => p.active === 1 || orderedAt < DISCONTINUED_AFTER);
      const weights = CATEGORY_WEIGHTS[customer.segment];
      const candidates = available.map((p) => [p, weights[p.category] * p.popularity] as const);
      const n = pickWeighted(rng, ITEMS_PER_ORDER);
      const chosen = new Map<number, ProductRow>();
      while (chosen.size < n) {
        const p = pickWeighted(rng, candidates);
        chosen.set(p.id, p);
      }
      const items = [...chosen.values()].sort((a, b) => a.id - b.id).map((p) => {
        const wholesale = customer.segment === 'cafeteria' && (p.category === 'graos' || p.category === 'moido');
        return { p, quantity: quantityFor(rng, customer.segment, p.category), unit: wholesale ? Math.round(p.price * CAFETERIA_DISCOUNT) : p.price };
      });
      const total = items.reduce((s, it) => s + it.quantity * it.unit, 0);
      insOrder.run(orderId, customer.id, orderedAt, pickWeighted(rng, CHANNEL_WEIGHTS[customer.segment]), statuses[i]!, total);
      for (const it of items) insItem.run(orderId, it.p.id, it.quantity, it.unit);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { counts: countRows(db), fingerprint: fingerprintSales(db) };
}

function countRows(db: DatabaseSync): SeedReport['counts'] {
  const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    customers: n('customers'),
    contacts: n('customer_contacts'),
    products: n('products'),
    orders: n('orders'),
    orderItems: n('order_items'),
  };
}

/** sha256 hex de um JSON canônico com contagens e agregados do banco. */
export function fingerprintSales(db: DatabaseSync): string {
  const byStatus = db.prepare('SELECT status AS k, SUM(total_cents) AS v FROM orders GROUP BY status ORDER BY status').all() as { k: string; v: number }[];
  const byCategory = db.prepare(`SELECT p.category AS k, SUM(i.quantity) AS v FROM order_items i
    JOIN products p ON p.id = i.product_id GROUP BY p.category ORDER BY p.category`).all() as { k: string; v: number }[];
  const range = db.prepare('SELECT MIN(ordered_at) AS min, MAX(ordered_at) AS max FROM orders').get() as { min: string | null; max: string | null };
  const canonical = JSON.stringify({
    counts: countRows(db),
    totalCentsByStatus: byStatus.map((r) => [r.k, r.v]),
    quantityByCategory: byCategory.map((r) => [r.k, r.v]),
    orderedAt: [range.min, range.max],
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const snapshots = new Map<number, Uint8Array>();

/** Seed num `:memory:` e `serialize()`, memoizado por semente (o mesmo buffer por processo). */
export function createSalesSnapshot(seed: number = DEFAULT_SEED): Uint8Array {
  const cached = snapshots.get(seed);
  if (cached) return cached;
  const db = new DatabaseSync(':memory:');
  try {
    seedSales(db, { seed });
    const bytes = db.serialize();
    snapshots.set(seed, bytes);
    return bytes;
  } finally {
    db.close();
  }
}
