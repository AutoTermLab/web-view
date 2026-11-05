// A minimal shapefile writer for the traces: PolyLine geometry in EPSG:4326 (.shp, .shx), the attributes as a dBase III
// table (.dbf), plus .prj and .cpg. Layout from the ESRI Shapefile Technical Description (1998).

export interface TraceFeature {
  geometry: { coordinates: number[][] };
  properties: { trace_id: string; date: string; sensor: string; season: string; uncertainty_m: number | null; status: string };
}

type Props = TraceFeature["properties"];
const FIELDS: { name: string; type: "C" | "D" | "N"; length: number; decimals?: number; value: (p: Props) => string }[] = [
  { name: "trace_id", type: "C", length: 32, value: (p) => p.trace_id },
  { name: "date", type: "D", length: 8, value: (p) => p.date.replaceAll("-", "") },
  { name: "sensor", type: "C", length: 4, value: (p) => p.sensor },
  { name: "season", type: "C", length: 3, value: (p) => p.season },
  { name: "uncert_m", type: "N", length: 12, decimals: 3, value: (p) => p.uncertainty_m?.toFixed(3) ?? "" },
  { name: "status", type: "C", length: 10, value: (p) => p.status },
];

const PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

type Box = [number, number, number, number];
function bounds(points: number[][]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  return box;
}

/** The 100-byte header shared by .shp and .shx. Lengths and offsets are in 16-bit words. */
function header(view: DataView, bytes: number, box: Box) {
  view.setInt32(0, 9994);
  view.setInt32(24, bytes / 2);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 3, true); // PolyLine
  box.forEach((v, i) => view.setFloat64(36 + 8 * i, v, true));
}

export function shapefile(features: TraceFeature[]) {
  const lines = features.map((f) => f.geometry.coordinates);
  const contents = lines.map((points) => 48 + 16 * points.length); // type, box, 1 part, point count, part index, points
  const shp = new Uint8Array(100 + contents.reduce((sum, c) => sum + 8 + c, 0));
  const shx = new Uint8Array(100 + 8 * features.length);
  const sv = new DataView(shp.buffer), xv = new DataView(shx.buffer);
  const all = bounds(lines.flat());
  header(sv, shp.length, all);
  header(xv, shx.length, all);

  let at = 100;
  lines.forEach((points, i) => {
    xv.setInt32(100 + 8 * i, at / 2);
    xv.setInt32(104 + 8 * i, contents[i] / 2);
    sv.setInt32(at, i + 1);
    sv.setInt32(at + 4, contents[i] / 2);
    sv.setInt32(at + 8, 3, true);
    bounds(points).forEach((v, k) => sv.setFloat64(at + 12 + 8 * k, v, true));
    sv.setInt32(at + 44, 1, true);
    sv.setInt32(at + 48, points.length, true);
    sv.setInt32(at + 52, 0, true);
    points.forEach(([x, y], k) => { sv.setFloat64(at + 56 + 16 * k, x, true); sv.setFloat64(at + 64 + 16 * k, y, true); });
    at += 8 + contents[i];
  });

  const text = new TextEncoder();
  return { shp, shx, dbf: dbf(features.map((f) => f.properties)), prj: text.encode(PRJ), cpg: text.encode("UTF-8") };
}

function dbf(rows: Props[]): Uint8Array {
  const headerSize = 32 + 32 * FIELDS.length + 1;
  const recordSize = 1 + FIELDS.reduce((sum, f) => sum + f.length, 0);
  const bytes = new Uint8Array(headerSize + recordSize * rows.length + 1).fill(0x20, headerSize);
  const view = new DataView(bytes.buffer);
  const now = new Date();
  bytes.set([3, now.getFullYear() - 1900, now.getMonth() + 1, now.getDate()]);
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerSize, true);
  view.setUint16(10, recordSize, true);

  const text = new TextEncoder();
  FIELDS.forEach((f, i) => {
    const at = 32 + 32 * i;
    bytes.set(text.encode(f.name), at);
    bytes[at + 11] = f.type.charCodeAt(0);
    bytes[at + 16] = f.length;
    bytes[at + 17] = f.decimals ?? 0;
  });
  bytes[headerSize - 1] = 0x0d;

  rows.forEach((row, r) => {
    let at = headerSize + r * recordSize + 1; // after the deletion flag, already a space
    for (const f of FIELDS) {
      const value = text.encode(f.value(row)).subarray(0, f.length);
      bytes.set(value, f.type === "N" ? at + f.length - value.length : at); // numbers right-aligned
      at += f.length;
    }
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
}
