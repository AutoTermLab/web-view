// Linking traces to the scenes they were drawn on (images.json, plan §5.6), and moving through traces by date.

export interface Scene {
  id: string;
  date: string;
  sensor: string;
  image: string; // relative to images/
  corners: [number, number][]; // lon/lat: top-left, top-right, bottom-right, bottom-left
  traces: string[];
}

export interface Trace {
  trace_id: string;
  date: string;
  sensor: string;
  season: string;
  uncertainty_m: number | null;
}

export function scenesByTrace(scenes: Scene[]): Map<string, Scene[]> {
  const index = new Map<string, Scene[]>();
  for (const scene of [...scenes].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const id of scene.traces) {
      if (!index.has(id)) index.set(id, []);
      index.get(id)!.push(scene);
    }
  }
  return index;
}

/**
 * A trace's scenes, the one holding most of its vertices first. A trace is linked to every scene of its date and
 * sensor that touches the glacier box, and some of those are slivers that miss the trace entirely.
 */
export function rankScenes(scenes: Scene[], coordinates: [number, number][]): { scene: Scene; share: number }[] {
  return scenes
    .map((scene) => ({ scene, share: coordinates.filter((p) => inside(p, scene.corners)).length / coordinates.length }))
    .sort((a, b) => b.share - a.share);
}

/** Ray casting; lon/lat is fine at the size of one scene. */
function inside([x, y]: [number, number], polygon: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function visibleTraces(traces: Trace[], sensors: Set<string>): Trace[] {
  return traces
    .filter((t) => sensors.has(t.sensor))
    .sort((a, b) => a.date.localeCompare(b.date) || a.trace_id.localeCompare(b.trace_id));
}

/** The trace `delta` places from `current` in a date-sorted list, stopping at the ends. */
export function step(list: Trace[], current: string, delta: number): string {
  const i = list.findIndex((t) => t.trace_id === current);
  return list[Math.min(Math.max(i + delta, 0), list.length - 1)].trace_id;
}

/** The first trace on or after `date`, else the last one (for when a filter hides the selected trace). */
export function nearest(list: Trace[], date: string): string | undefined {
  return (list.find((t) => t.date >= date) ?? list.at(-1))?.trace_id;
}
