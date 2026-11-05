// Trace colors, by sensor or by season, readable over imagery and clear of the selected trace's red.

export const SENSOR_COLORS: Record<string, string> = { // Okabe–Ito
  L5: "#E69F00", L7: "#56B4E9", L8: "#009E73", S1: "#F0E442", S2: "#CC79A7",
};
// Shares no color with the sensors (OKLab ΔE ≥ 18 to each of them, normal vision), so the two modes aren't confused;
// every pair stays apart under simulated protan and deutan vision too (ΔE ≥ 9).
export const SEASON_COLORS: Record<string, string> = { // winter ice cyan, spring green, summer magenta, autumn violet
  DJF: "#80FFFF", MAM: "#26E600", JJA: "#FF4DFF", SON: "#5A3DFF",
};

export type ColorBy = "sensor" | "season";

/** A MapLibre expression coloring each trace by its sensor or season property. */
export function traceColor(by: ColorBy) {
  const colors = by === "sensor" ? SENSOR_COLORS : SEASON_COLORS;
  return ["match", ["get", by], ...Object.entries(colors).flat(), "#fff"];
}
