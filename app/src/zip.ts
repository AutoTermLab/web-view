// A minimal zip writer: stored (uncompressed) entries with CRC-32, no zip64, so under 4 GB and 65,535 files. Returns a
// Blob of the parts, so large archives (the scene previews, update plan §5) aren't copied into one buffer.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile { name: string; data: Uint8Array }

export function zip(files: ZipFile[], modified = new Date()): Blob {
  const time = (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
  const date = ((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();
  const parts: BlobPart[] = [], directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    // the fields local and central headers share, from "version needed" to "name length"
    const common = (view: DataView, at: number) => {
      view.setUint16(at, 10, true); // version needed: 1.0 (stored)
      view.setUint16(at + 2, 0x0800, true); // names are UTF-8
      view.setUint16(at + 4, 0, true); // method: stored
      view.setUint16(at + 6, time, true);
      view.setUint16(at + 8, date, true);
      view.setUint32(at + 10, crc, true);
      view.setUint32(at + 14, data.length, true); // compressed size
      view.setUint32(at + 18, data.length, true);
      view.setUint16(at + 22, nameBytes.length, true);
    };

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    common(lv, 4);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by: 2.0
    common(cv, 6);
    cv.setUint32(42, offset, true); // where the local header starts
    central.set(nameBytes, 46);

    parts.push(local, data as Uint8Array<ArrayBuffer>); // never a SharedArrayBuffer here
    directory.push(central);
    offset += local.length + data.length;
  }

  const size = directory.reduce((sum, d) => sum + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); // entries on this disk
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
