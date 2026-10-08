// Estimativa de tokens quando o provedor não informa `usage` (aproximação de 4 caracteres por token).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
