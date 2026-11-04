// Warping a scene preview into Web Mercator in the browser, so MapLibre can place it exactly from its corners.
//
// A preview is a rectangle in its scene's UTM zone, but images.json stores only its four lon/lat corners. MapLibre
// draws an image linearly between its corners in Web Mercator, and Mercator stretches with latitude, so pixels inside
// a large northern scene land up to hundreds of metres off (plan §4.5). Resampling the preview onto a Mercator grid
// makes its corners an exact rectangle on the map. The zone is read off the corners: only the true zone turns them
// back into an axis-aligned rectangle (checked on all 352,062 previews). The uploaded previews are not changed.

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
type LonLat = [number, number];

const R = 6378137; // Web Mercator sphere
export const toMercator = (lon: number, lat: number): [number, number] =>
  [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
export const fromMercator = (x: number, y: number): LonLat =>
  [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

// WGS84 transverse Mercator, Krüger series to n^4 (Karney 2011): sub-millimetre well beyond a zone's edges.
const n = 1 / 298.257223563 / (2 - 1 / 298.257223563);
const A = 6378137 / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64);
const ALPHA = [
  n / 2 - 2 / 3 * n ** 2 + 5 / 16 * n ** 3 + 41 / 180 * n ** 4,
  13 / 48 * n ** 2 - 3 / 5 * n ** 3 + 557 / 1440 * n ** 4,
  61 / 240 * n ** 3 - 103 / 140 * n ** 4,
  49561 / 161280 * n ** 4,
];
const E2N = 2 * Math.sqrt(n) / (1 + n);

/** lon/lat → UTM easting/northing (northern hemisphere) in `zone`. */
export function toUtm(lon: number, lat: number, zone: number): [number, number] {
  const phi = lat * Math.PI / 180, dl = (lon - (zone * 6 - 183)) * Math.PI / 180;
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - E2N * Math.atanh(E2N * s));
  const xi = Math.atan2(t, Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  ALPHA.forEach((a, j) => {
    x += a * Math.cos(2 * (j + 1) * xi) * Math.sinh(2 * (j + 1) * eta);
    y += a * Math.sin(2 * (j + 1) * xi) * Math.cosh(2 * (j + 1) * eta);
  });
  return [500000 + 0.9996 * A * x, 0.9996 * A * y];
}

/** The UTM zone in which the corners (top-left, top-right, bottom-right, bottom-left) form an axis-aligned rectangle. */
export function inferZone(corners: LonLat[]): number {
  const centre = Math.floor((corners.reduce((sum, [lon]) => sum + lon, 0) / 4 + 180) / 6) + 1;
  let best = centre, bestResidual = Infinity;
  for (let zone = centre - 2; zone <= centre + 2; zone++) {
    const [tl, tr, br, bl] = corners.map(([lon, lat]) => toUtm(lon, lat, zone));
    const residual = Math.max(Math.abs(tl[1] - tr[1]), Math.abs(bl[1] - br[1]), Math.abs(tl[0] - bl[0]), Math.abs(tr[0] - br[0]));
    if (residual < bestResidual) [best, bestResidual] = [zone, residual];
  }
  return best;
}

const MAX_SIZE = 4096; // a safe WebGL texture size
const STEP = 8; // the exact projection is computed every STEP output pixels and interpolated in between

/**
 * Resample a UTM-aligned preview onto a Web Mercator grid (nearest neighbour, so pixel values are kept as they are).
 * Returns the new image and its corners, which now form an exact rectangle in Mercator.
 */
export function warpToMercator(source: Pixels, corners: LonLat[], zone: number): { image: Pixels; corners: LonLat[] } {
  const utm = corners.map(([lon, lat]) => toUtm(lon, lat, zone));
  const x0 = (utm[0][0] + utm[3][0]) / 2, x1 = (utm[1][0] + utm[2][0]) / 2;
  const y1 = (utm[0][1] + utm[1][1]) / 2, y0 = (utm[2][1] + utm[3][1]) / 2;

  // Mercator bounds: the scene's edges curve in Mercator, so sample along them, not just at the corners.
  let mw = Infinity, me = -Infinity, ms = Infinity, mn = -Infinity;
  const edge = (lon: number, lat: number) => {
    const [x, y] = toMercator(lon, lat);
    mw = Math.min(mw, x); me = Math.max(me, x); ms = Math.min(ms, y); mn = Math.max(mn, y);
  };
  for (let k = 0; k <= 32; k++) for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
    edge(corners[a][0] + (corners[b][0] - corners[a][0]) * k / 32, corners[a][1] + (corners[b][1] - corners[a][1]) * k / 32);
  }
  // The edges are straight in UTM, not in lon/lat; the gap is far below a pixel at these sizes, so pad by one.

  // Keep the source's pixel size (Mercator metres are 1/cos(lat) ground metres), capped to the texture limit.
  const latMid = (corners[0][1] + corners[2][1]) / 2;
  let size = (x1 - x0) / source.width / Math.cos(latMid * Math.PI / 180);
  size = Math.max(size, (me - mw) / MAX_SIZE, (mn - ms) / MAX_SIZE);
  mw -= size; me += size; ms -= size; mn += size;
  const width = Math.ceil((me - mw) / size), height = Math.ceil((mn - ms) / size);

  // Source column and row for each grid node, from the exact projection.
  const gw = Math.ceil(width / STEP) + 1, gh = Math.ceil(height / STEP) + 1;
  const grid = new Float64Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const [lon, lat] = fromMercator(mw + (i * STEP + 0.5) * size, mn - (j * STEP + 0.5) * size);
    const [x, y] = toUtm(lon, lat, zone);
    grid[(j * gw + i) * 2] = (x - x0) / (x1 - x0) * source.width;
    grid[(j * gw + i) * 2 + 1] = (y1 - y) / (y1 - y0) * source.height;
  }

  const out = new Uint8ClampedArray(width * height * 4);
  for (let r = 0; r < height; r++) {
    const j = Math.floor(r / STEP), v = (r % STEP) / STEP;
    for (let c = 0; c < width; c++) {
      const i = Math.floor(c / STEP), u = (c % STEP) / STEP;
      const g00 = (j * gw + i) * 2, g10 = g00 + 2, g01 = g00 + gw * 2, g11 = g01 + 2;
      const sc = Math.floor((1 - v) * ((1 - u) * grid[g00] + u * grid[g10]) + v * ((1 - u) * grid[g01] + u * grid[g11]));
      const sr = Math.floor((1 - v) * ((1 - u) * grid[g00 + 1] + u * grid[g10 + 1]) + v * ((1 - u) * grid[g01 + 1] + u * grid[g11 + 1]));
      if (sc < 0 || sr < 0 || sc >= source.width || sr >= source.height) continue;
      const from = (sr * source.width + sc) * 4, to = (r * width + c) * 4;
      out[to] = source.data[from]; out[to + 1] = source.data[from + 1];
      out[to + 2] = source.data[from + 2]; out[to + 3] = source.data[from + 3];
    }
  }

  const [w, n] = fromMercator(mw, mn), [e, s] = fromMercator(me, ms);
  return { image: { width, height, data: out }, corners: [[w, n], [e, n], [e, s], [w, s]] };
}
