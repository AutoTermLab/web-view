import { describe, expect, it } from "vitest";
import { fromMercator, inferZone, toMercator, toUtm, warpToMercator, type Pixels } from "./warp";

// [zone, lon, lat, easting, northing] from pyproj (EPSG:326xx), including points 5.5° off the central meridian
const REFERENCE = [
  [22, -51.0, 69.2, 500000.0, 7676663.3037],
  [22, -49.47, 69.29, 560378.8518, 7687453.1257],
  [24, -39.2, 65.6, 490780.7482, 7275340.7357],
  [27, -21.5, 80.1, 490403.1885, 8892788.6279],
  [20, -62.6, 79.99, 507761.9057, 8880496.3454],
  [20, -66.8, 79.98, 426239.2654, 8881763.1386],
  [25, -30.0, 82.5, 543697.6721, 9161777.8415],
  [23, -43.0, 60.1, 611207.1713, 6664230.8908],
  [22, -56.5, 72.0, 310538.3756, 7997588.8594],
  [26, -24.5, 76.3, 566075.9231, 8470061.5516],
];

describe("toUtm", () => {
  it("matches pyproj to the millimetre", () => {
    for (const [zone, lon, lat, x, y] of REFERENCE) {
      const [e, n] = toUtm(lon, lat, zone);
      expect(Math.abs(e - x)).toBeLessThan(0.001);
      expect(Math.abs(n - y)).toBeLessThan(0.001);
    }
  });
});

describe("Web Mercator", () => {
  it("round-trips", () => {
    const [lon, lat] = fromMercator(...toMercator(-49.47, 79.29));
    expect(lon).toBeCloseTo(-49.47, 9);
    expect(lat).toBeCloseTo(79.29, 9);
  });
});

/** UTM → lon/lat by Newton's method on toUtm, so the tests need no other projection code. */
function fromUtm(x: number, y: number, zone: number): [number, number] {
  let lon = zone * 6 - 183, lat = 80;
  for (let k = 0; k < 20; k++) {
    const d = 1e-6, [e, n] = toUtm(lon, lat, zone);
    const [ex, nx] = toUtm(lon + d, lat, zone), [ey, ny] = toUtm(lon, lat + d, zone);
    const a = (ex - e) / d, b = (ey - e) / d, c = (nx - n) / d, dd = (ny - n) / d, det = a * dd - b * c;
    lon += (dd * (x - e) - b * (y - n)) / det;
    lat += (a * (y - n) - c * (x - e)) / det;
  }
  return [lon, lat];
}

// A UTM-aligned scene in zone 20 near 80°N, 40 km wide and 80 km tall (like GID85's large ones), with 100 m pixels
// and lon/lat corners rounded like images.json.
const ZONE = 20, X0 = 470000, X1 = 510000, Y0 = 8820000, Y1 = 8900000, W = 400, H = 800;
const round = ([lon, lat]: [number, number]): [number, number] => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
const corners = [[X0, Y1], [X1, Y1], [X1, Y0], [X0, Y0]].map(([x, y]) => round(fromUtm(x, y, ZONE)));

// Points inside the scene: UTM position and true lon/lat.
const points = Array.from({ length: 500 }, (_, k) => {
  const x = X0 + 1000 + ((k * 7919) % 38000), y = Y0 + 1000 + ((k * 104729) % 78000);
  return { x, y, lonlat: fromUtm(x, y, ZONE) };
});

describe("inferZone", () => {
  it("finds the zone in which the corners form a rectangle", () => {
    expect(inferZone(corners)).toBe(ZONE);
  });
});

describe("warpToMercator", () => {
  // Each source pixel stores its own column and row, so the output shows where every pixel came from.
  const data = new Uint8ClampedArray(W * H * 4);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) data.set([c % 256, r % 256, (c >> 8) * 16 + (r >> 8), 255], (r * W + c) * 4);
  const source: Pixels = { width: W, height: H, data };
  const out = warpToMercator(source, corners, ZONE);

  it("returns a Mercator-aligned rectangle", () => {
    const [[w, n], [e, n2], [e2, s], [w2, s2]] = out.corners;
    expect([n2, e2, s2, w2]).toEqual([n, e, s, w]);
  });

  it("puts every source pixel where it really is, to within one pixel", () => {
    const [[w, n], [e], , [, s]] = out.corners;
    const [mw, mn] = toMercator(w, n), [me, ms] = toMercator(e, s);
    let worst = 0;
    for (const { x, y, lonlat } of points) {
      const [mx, my] = toMercator(...lonlat);
      const col = Math.floor(((mx - mw) / (me - mw)) * out.image.width);
      const row = Math.floor(((mn - my) / (mn - ms)) * out.image.height);
      const i = (row * out.image.width + col) * 4, px = out.image.data;
      const got = [px[i] + (px[i + 2] >> 4) * 256, px[i + 1] + (px[i + 2] & 15) * 256];
      const want = [(x - X0) / 100, (Y1 - y) / 100];
      worst = Math.max(worst, Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
    }
    expect(worst).toBeLessThanOrEqual(1.5);
  });

  it("(control) the unwarped preview, drawn linearly between its corners in Mercator, is off by several pixels", () => {
    const m = corners.map(([lon, lat]) => toMercator(lon, lat)); // tl, tr, br, bl
    let worst = 0;
    for (const { x, y, lonlat } of points) {
      const u = (x - X0) / (X1 - X0), v = (Y1 - y) / (Y1 - Y0); // where the point is in the image
      const at = [0, 1].map((k) => (1 - u) * (1 - v) * m[0][k] + u * (1 - v) * m[1][k] + u * v * m[2][k] + (1 - u) * v * m[3][k]);
      const [mx, my] = toMercator(...lonlat);
      worst = Math.max(worst, (Math.hypot(at[0] - mx, at[1] - my) * Math.cos((lonlat[1] * Math.PI) / 180)) / 100);
    }
    expect(worst).toBeGreaterThan(5);
  });

  it("leaves the area outside the scene transparent", () => {
    // Mercator widens the north edge more than the south one, so the bottom-left output pixel lies outside the scene
    const { width, height, data: px } = out.image;
    expect(px[(height - 1) * width * 4 + 3]).toBe(0);
    expect(px[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3]).toBe(255);
  });
});
