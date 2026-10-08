// Milissegundos desde t0 (performance.now()), com duas casas, para as entradas do trace.
export const elapsedMs = (t0: number): number => Math.round((performance.now() - t0) * 100) / 100;
