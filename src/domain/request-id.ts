import { randomUUID } from 'node:crypto';
import { REQUEST_ID_PATTERN } from './schemas.ts';

/**
 * Aceita o requestId recebido só se casar REQUEST_ID_PATTERN; senão gera um novo.
 * `replaced` é true só quando veio um valor presente que não casa o padrão (aviso `request_id_replaced`).
 */
export function resolveRequestId(candidate: unknown, gen: () => string = randomUUID): { id: string; replaced: boolean } {
  if (typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)) {
    return { id: candidate, replaced: false };
  }
  const present = candidate !== undefined && candidate !== null;
  return { id: gen(), replaced: present };
}
