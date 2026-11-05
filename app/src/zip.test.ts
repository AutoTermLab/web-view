import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip";

const text = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the standard check values", () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(text("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("zip", () => {
  it("stores each file uncompressed, with a central directory that points back at it", async () => {
    const files = [{ name: "a.txt", data: text("hello") }, { name: "dir/b.bin", data: new Uint8Array([1, 2, 3]) }];
    const bytes = new Uint8Array(await zip(files, new Date(2026, 10, 5, 14, 30, 10)).arrayBuffer());
    const view = new DataView(bytes.buffer);

    // end of central directory: the last 22 bytes, with no comment
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2); // entries
    const dirSize = view.getUint32(end + 12, true), dirStart = view.getUint32(end + 16, true);
    expect(dirStart + dirSize).toBe(end);

    let entry = dirStart;
    for (const file of files) {
      expect(view.getUint32(entry, true)).toBe(0x02014b50);
      expect(view.getUint16(entry + 10, true)).toBe(0); // stored
      expect(view.getUint32(entry + 16, true)).toBe(crc32(file.data));
      expect(view.getUint32(entry + 20, true)).toBe(file.data.length);
      const nameLength = view.getUint16(entry + 28, true);
      expect(new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + nameLength))).toBe(file.name);

      const local = view.getUint32(entry + 42, true);
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      expect(view.getUint16(local + 12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 5); // DOS date
      expect(view.getUint16(local + 10, true)).toBe((14 << 11) | (30 << 5) | 5); // DOS time, 2 s steps
      const dataStart = local + 30 + view.getUint16(local + 26, true);
      expect(bytes.subarray(dataStart, dataStart + file.data.length)).toEqual(file.data);
      entry += 46 + nameLength;
    }
  });
});
