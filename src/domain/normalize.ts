// Normalização de texto para chaves de fixture, regras de injeção e guarda de saída:
// NFKD, sem diacríticos, minúsculas, tudo que não é [a-z0-9] vira espaço, espaços colapsados.
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
