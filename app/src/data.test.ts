import { describe, expect, it } from "vitest";
import { imageUrl, imagesIndexUrl, versionUrl } from "./data";

const base = "https://example.r2.dev/autoterm";

describe("bucket paths", () => {
  it("joins versioned files to the version root", () => {
    expect(versionUrl(base, "v1", "glaciers/GID1/traces.geojson")).toBe(`${base}/v1/glaciers/GID1/traces.geojson`);
  });

  it("puts imagery under the unversioned images/ prefix", () => {
    expect(imagesIndexUrl(base, "GID278")).toBe(`${base}/images/GID278/images.json`);
    expect(imageUrl(base, "GID278/LT05_008011_19850610.avif")).toBe(`${base}/images/GID278/LT05_008011_19850610.avif`);
  });
});
