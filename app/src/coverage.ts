// Trace coverage over time: how many traces each calendar month holds, by sensor (the glacier view's year × month grid).
import type { Trace } from "./scenes";

/** The meteorological season of each month, January first (plan §6.3). */
export const MONTH_SEASONS = ["DJF", "DJF", "MAM", "MAM", "MAM", "JJA", "JJA", "JJA", "SON", "SON", "SON", "DJF"];

/** Counts by sensor for each "YYYY-MM" that has a trace of the chosen sensors. */
export function coverage(traces: Trace[], sensors: Set<string>): Map<string, Record<string, number>> {
  const cells = new Map<string, Record<string, number>>();
  for (const t of traces) {
    if (!sensors.has(t.sensor)) continue;
    const key = t.date.slice(0, 7);
    if (!cells.has(key)) cells.set(key, {});
    const cell = cells.get(key)!;
    cell[t.sensor] = (cell[t.sensor] ?? 0) + 1;
  }
  return cells;
}

/** Shade class of a month's count, doubling per step: 0 | 1 | 2–3 | 4–7 | 8–15 | 16+ (median month 2, 99% ≤ 20 in v1). */
export function countClass(n: number): number {
  return n <= 0 ? 0 : Math.min(Math.floor(Math.log2(n)) + 1, 5);
}
