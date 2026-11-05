# AutoTerm Web Viewer — Implementation Plan

Status: accepted for development · 2026-10-22. Where §11 is still open, build with the stated defaults.

A static web app, hosted on GitHub Pages, for browsing and inspecting the AutoTerm Greenland glacier terminus dataset (Zhang et al., 2023, *The Cryosphere* 17, 3485–3503). The data lives in a Cloudflare R2 bucket and is fetched piece by piece. The app never downloads the full archive.

---

## 1. Goals and scope

### v1
- Browse all 295 glaciers on an overview map and in a sortable, filterable table.
- Organize and filter by **sensor** (Landsat 5/7/8, Sentinel-1/2), **season**, and **length-change trend** (called "retreat rate" in early notes).
- Glacier detail view: terminus traces on a satellite basemap, colored by date or sensor, plus a time series of terminus change.
- Per-trace inspection: date, sensor, uncertainty, and status.
- **Source imagery:** the satellite scene each published trace was drawn on, shown as a preview under the trace. It covers 218,464 of 218,469 traces (§4.5, §5.6). How the scenes and previews were made is in `docs/imagery-procedure.md`.
- Download individual sets through the viewer: full-resolution traces per glacier (GeoPackage), plus the per-glacier time series (CSV).

### Later (designed for now, not built in v1)
- **Images that failed screening.** View rejected traces and their source-image thumbnails, with the reason for rejection. The data isn't available yet. The schema and bucket layout reserve space for it (§4.3, §5.2), so adding it requires no restructuring.
- Length-change trend over the full 1984–2021 record, and advance/retreat labels once the sign convention is confirmed (§6.4).
- Greenland-wide trace overview (PMTiles) and ice-mask overlays (COG).

### Non-goals
- No server or backend. Everything is static files on GitHub Pages plus R2.
- No editing or curation of the data.

---

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Hosting (app) | GitHub Pages, deployed by GitHub Actions |
| Hosting (data) | Cloudflare R2. Live on the custom domain `https://autoterm.bandicoots.net/autoterm` since 2026-11-04 (first on `r2.dev`, to be disabled once the deployed site has switched). Only `DATA_BASE_URL` changed. `v1` was uploaded 2026-10-22 and verified (§7) |
| Data organization | Small files per glacier at predictable paths, under an immutable versioned prefix (§4) |
| Resolution | **Both.** Simplified traces for display, plus full-resolution GeoPackage per glacier for download. Revisit only if performance becomes a problem |
| Storage budget | Under 10 GB total (R2 free tier). With the previews it is 9.97 GB (`v1` 3.42 GB + previews 6.55 GB), just under (§4.4) |
| Frontend | Vite + TypeScript (no UI framework), MapLibre GL JS, Observable Plot |
| Data prep | Python, run locally with `uv`; the raw archive never enters the repo or the bucket |
| Tests | `pytest` (prep), Vitest (app logic), `tools/browser/` (visual and console checks, run only before the final merge) — see §8.4 |
| Repo / Pages | `github.com/AutoTermLab/web-view` → `https://autotermlab.github.io/web-view/` |

---

## 3. Source data inventory

Raw archive: `~/Downloads/autoterm_data/` (1.8 GB of zips).

| File | Contents | Use |
|---|---|---|
| `Termini.zip` | 295 shapefiles (`GID{n}.shp`), PolylineZ, WGS84. Fields: `Date`, `Glacier ID`, `Satellite`, `Uncertaint` (all stored as strings). ~1,300 traces per glacier, ~370 vertices per trace. 3.2 GB of `.shp` in total | Traces (display + download) |
| `time_series_terminus_variation_new.zip` | 292 CSVs (`GID{n}_all_S1_corrected.csv`): change in area (`10 km2`), change in length (m), decimal date, date. **Covers 2013 to 2020–2021 only.** Also contains PNG plots and KML (not used) | Time series, retreat rate (v1) |
| `Glacier Identification.csv` | 295 glaciers: lat/lon, official/new/old/foreign names, Moon ID, Bjørk ID, ROI, historical ROI | Glacier index |
| `uncertainty_all.csv` | Per glacier: MC-dropout uncertainty for L5/L7/L8/S1/S2 + duplicate-trace uncertainty (m) | Glacier index |
| `reference_polygon_new_ID.zip` | Reference polygon per glacier (used to build training labels) | Full-record length-change trend (later, §6.4) |
| `Icemask.zip` | GrIMP-based masks 2018–2020, 15 m GeoTIFF | Later (COG overlay) |
| `label_shape_TermPicks.zip` | TermPicks training labels | Not used |

### Known data issues (the build must handle these)
1. `Glacier Identification.csv`: the data rows are UTF-8 (`Isbræ`) but the header has a stray non-UTF-8 byte (`Bj\xbfrkID`). The parser skips the header and reads columns by position.
2. **ROI strings look corrupted.** Digits seem to have been replaced by spaces (`"[-51.76,71.7 8,-51.52,71.777]"`). Repair rule TBD (§11 Q3). Until it's settled, the ROI is stored as `null` with the raw string kept for reference.
3. `uncertainty_all.csv` has a BOM, ~700 trailing blank rows, and 77 `#N/A` cells (sensors with no data for that glacier), which become `null`.
4. 3 glaciers have no time series, and 1 time series file has only a header. The build must allow a missing time series.
5. The zips contain `__MACOSX/` junk; skip it.
6. The time series area unit is labelled `10 km2`, which needs confirming against the manuscript or authors before area is shown in the UI. v1 charts use **length change (m)**, which is unambiguous.
7. Trace key uniqueness: `(glacier, date, sensor)` is unique for GID1 but not everywhere. 14 glaciers have same-day Sentinel-1 passes with different geometry; they are kept and the later one gets a `_2` id suffix (§4.1).
8. **Five files mix traces from two glaciers.** `GID101`, `GID177`, `GID266`, `GID47` and `GID81` hold traces whose per-trace `Glacier ID` names another glacier (`GID102`, `GID178`, `GID262`, `GID48`, `GID29`). The per-trace label is the reliable one (the L8/S1/S2 uncertainties match the labeled glacier in `uncertainty_all.csv`). The build groups traces by label across files and merges exact duplicates (same date, sensor and geometry); each file read and merge is logged. For four of the five, the foreign traces were exact duplicates of the other glacier's own file.
9. **GID262 is unresolved (question for the dataset authors).** The 621 traces labeled `GID262` inside `GID266.shp` do not merge with `GID262.shp`: 379 share a date and sensor with a trace in `GID262.shp`, with identical uncertainty but different geometry (median separation ~1.8 km). Until the authors answer, both are kept and the second gets a `_2` id suffix.
10. **`GID65.shp` contains 178 exact in-file duplicates** (Sentinel-1, same date and geometry). They are merged and logged, so for that glacier source count = kept + merged.
11. The release holds 220,818 traces, not the 278,239 in the manuscript.
12. **Time series rows are not in date order** (290 of 291 files). The reader sorts them by time.
13. **Some time series are physically meaningless.** `GID94`, `GID100`, `GID101` and `GID215` reach 68 to 445 km of "length change". `GID81`, `85` and `86` have no series and `GID266` is header-only. `.csv` and `.txt` versions are identical, so only the CSV is read.
14. **Sign convention is undocumented.** The manuscript does not say whether positive "change in length" means advance or retreat. Evidence is mixed (see §11 item 9), so v1 shows the raw slope with no advance/retreat label or category.

---

## 4. R2 bucket layout (spec)

This section is what the bucket setup is built from.

```
autoterm/
  latest.json                          {"version": "v1"}  — the only file overwritten in place
  v1/
    manifest.json                      version info + every file's path, size, sha256
    glaciers.json                      index of all glaciers (loaded at app start)
    glaciers/
      GID1/
        traces.geojson                 simplified traces for display
        timeseries.json                terminus change time series
        download/
          GID1_traces.gpkg             full-resolution traces (all attributes)
          GID1_timeseries.csv          time series as CSV
      GID2/
      …
    overview/                          (later) traces.pmtiles
    icemask/                           (later) 2018.tif, 2019.tif, 2020.tif as COG
  images/                              scene previews, NOT versioned (live since 2026-11-04, §4.5)
    GID1/
      images.json                      index of the glacier's scenes: corners, linked trace ids (§5.6)
      {scene_id}.avif                  one preview per scene, e.g. LT05_008011_19850610.avif
    GID2/
    …
```

### 4.1 Conventions
- **Glacier key:** `GID{n}`, matching the source file names. Kept as a string so future tributary suffixes (`GID28a`, manuscript §5.5) need no schema change.
- **Trace ID:** `GID{n}_{YYYYMMDD}_{SENSOR}`, with sensor codes `L5 L7 L8 S1 S2`. Example: `GID1_20170209_S1`. If a collision occurs (e.g., two S1 passes on the same day), add a `_{k}` suffix starting at 2, and log it.
- **Versioning:** everything under `v{N}/` is write-once. A rebuild publishes `v{N+1}/` and then updates `latest.json`. Old versions stay in place for reproducibility while under the storage budget. `images/` is the exception: it sits outside the versions, because a scene doesn't change when the trace data is rebuilt. Its indexes can be replaced in place (short cache, §4.2).
- **Relative paths everywhere:** JSON files refer to other files by paths relative to the version root (`glaciers/GID1/traces.geojson`). The app joins them with `DATA_BASE_URL` + version.

### 4.2 HTTP headers per file type

| Pattern | Content-Type | Content-Encoding | Cache-Control |
|---|---|---|---|
| `latest.json` | `application/json` | — | `public, max-age=60` |
| `v*/**/*.json`, `*.geojson` | `application/json` / `application/geo+json` | `gzip` (uploaded pre-compressed) | `public, max-age=31536000, immutable` |
| `v*/**/*.csv` | `text/csv; charset=utf-8` | — (small, downloaded as-is) | immutable (as above) |
| `v*/**/*.gpkg` | `application/geopackage+sqlite3` | — (download as-is) | immutable, plus `Content-Disposition: attachment` |
| `images/*/*.avif` | `image/avif` | — | `public, max-age=604800` (a week: rebuilt only if a scene is fetched again) |
| `images/*/images.json` | `application/json` | `gzip` (uploaded pre-compressed) | `public, max-age=300` (will be rebuilt to add the tier and data version) |
| `*.pmtiles`, `*.tif` (later) | `application/vnd.pmtiles`, `image/tiff` | **never gzip**, because range requests must work | immutable |

### 4.3 Bucket CORS policy

```json
[
  {
    "AllowedOrigins": ["https://autotermlab.github.io", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

### 4.4 Size estimate
- Display data (all glaciers): ~250 MB raw, ~65 MB gzipped (extrapolated from GID1).
- Full-resolution GeoPackages: ~3–3.5 GB.
- About 3.5 GB per version. With the previews (6.55 GB, shared by all versions), `v1` alone uses 9.97 GB (9.29 GiB), just under 10 GB. A second version takes it over. R2 storage over the free allowance costs about $0.015 per GB-month, so each extra version adds roughly 5 cents a month (§11 Q6).
- `r2.dev` is rate-limited and not CDN-cached, so the data is now served from the custom domain `autoterm.bandicoots.net`, with a Cache Rule. Cloudflare publishes no number for the `r2.dev` limit (§12).

### 4.5 Imagery (`images/`)
- **What:** one preview per downloaded scene: 352,062 AVIFs for 295 glaciers. Each is a single band, stretched to 8 bits and halved in size, with no-data transparent. Median 8.7 KB, 1 in 100 over 155 KB, largest 558 KB.
- **Linking:** each glacier's `images.json` (§5.6) lists its scenes with their corners and the ids of the traces drawn on them, matched by date and sensor. 218,464 of 218,469 traces are linked. The other 5 are Landsat 5 traces with no scene that day in Earth Engine.
- **More than one scene per trace:** 146,781 traces (67%) link to one scene. The rest link to 2 to 36, e.g. adjacent tiles or orbits on the same day. Each linked scene covers part of the glacier box, but not necessarily the trace (a refinement is listed in `docs/imagery-procedure.md`).
- **Caveats the viewer must show:**
  - about 3,500 traces rely on Landsat Tier 2 scenes, which for L5 align worse (median 30 m against 15 m for Tier 1);
  - GID85's large S1 and S2 scenes are mostly at 20 m instead of 10 m.
  - `images.json` doesn't record the tier yet, so the label needs a rebuild of the indexes first.
- **Placement: each preview is warped into Web Mercator in the browser** (`app/src/warp.ts`, 2026-11-04). The previews are in their scene's UTM zone, and MapLibre draws an image linearly between its corners in Mercator, which stretches with latitude. Drawn straight from the four corners, a preview's pixels land off their true position. Over 600 random scenes, the worst point per scene is off by a median 3.6 m, 15 m at the 90th percentile, 160 m at the 99th and 770 m at worst. On GID85's 80 × 100 km Landsat 5 scene of 1985-04-20 it was 1.4–1.8 km, with MapLibre 6's default perspective warp.
  - **How:** the app reads the UTM zone off the corners (only the true zone turns them back into an axis-aligned rectangle: within 1.1 m for all 352,062 previews, and it matched the GeoTIFF for 3,000 of 3,000 checked). It then resamples the preview, nearest neighbour, onto a Mercator grid whose corners are an exact rectangle. The UTM projection is our own (Krüger series), tested against pyproj to the millimetre.
  - **Result:** in tests, pixels land within 1.5 preview pixels of their true position, which is the nearest-neighbour rounding. The largest preview (2,099 × 2,928) takes about 100 ms. In the browser, GID85's scene moved 15–18 screen pixels north, as predicted.
  - **Data:** the uploaded previews and `images.json` are unchanged. Every scene is in a UTM north zone (18–28; 5,607 sampled). A scene in another projection would need its EPSG code in `images.json`.
  - **Limit:** for 395 small previews a neighbouring zone also fits within 50 m, so a wrong pick shifts them by at most about that.
- **Built by** `prep/build_previews.py` and uploaded by hand (`docs/imagery-procedure.md`, steps 6 and 8). `prep/upload.sh` has no images mode.

---

## 5. File schemas

### 5.1 `glaciers.json`
```jsonc
{
  "schema": 1,
  "version": "v1",
  "generated": "2026-10-22",
  "glaciers": [
    {
      "id": "GID1",
      "num": 1,
      "name": "Kangilliup Sermia",          // Official_n, else New_Greenl, else null
      "names": { "official": "…", "new_greenlandic": "…", "old_greenlandic": "…", "foreign": "Rink Isbræ" },
      "moon_id": 17,
      "bjork_id": "GGN0347",
      "lat": 71.763574, "lon": -51.559875,
      "bbox": [-51.7357, 71.7144, -51.6062, 71.7538],   // from the traces, not the ROI
      "roi": null, "roi_raw": "[-51.76,71.7 8,-51.52,71.777]",
      "uncertainty_m": { "L5": 20.6, "L7": 15.8, "L8": 23.6, "S1": 23.9, "S2": 12.8, "duplicate": 25.5 },
      "date_range": ["<first trace date>", "<last trace date>"],
      "counts": {                           // traces that passed screening
        "total": 1296,
        "by_sensor": { "L5": 140, "L7": 215, "L8": 188, "S1": 396, "S2": 357 },
        "by_season": { "DJF": 0, "MAM": 0, "JJA": 0, "SON": 0 },
        "by_year_sensor": { "2017": { "S1": 40, "S2": 31 } }   // for the coverage heatmap
      },
      "rejected_count": null,               // null until rejected traces arrive
      "length_trend": {                     // raw slope as given in the source; no advance/retreat label
        "slope_m_per_yr": -120.0,           // illustrative value
        "period": ["2013-03-30", "2021-05-28"],
        "method": "ols_length_change",
        "n": 941
      },
      "files": {
        "traces": "glaciers/GID1/traces.geojson",
        "timeseries": "glaciers/GID1/timeseries.json",
        "download_traces": "glaciers/GID1/download/GID1_traces.gpkg",
        "download_timeseries": "glaciers/GID1/download/GID1_timeseries.csv"
      }
    }
  ]
}
```
Any file entry can be `null` (e.g., the 3 glaciers without a time series). The UI hides the matching feature.

### 5.2 `traces.geojson` (display)
A FeatureCollection of LineStrings, lon/lat rounded to 5 decimals (~1 m), Z dropped, simplified with a 5 m tolerance in EPSG:3413 and then transformed back to WGS84.

```jsonc
{
  "type": "Feature",
  "id": "GID1_20170209_S1",
  "geometry": { "type": "LineString", "coordinates": [[-51.70123, 71.73456], …] },
  "properties": {
    "trace_id": "GID1_20170209_S1",  // same as the feature id; use as MapLibre promoteId (string feature ids are not usable for feature-state)
    "date": "2017-02-09",
    "t": 2017.1068,                 // decimal year (day/365 or 366), used for color scales; join other data on `date`, not `t`
    "sensor": "S1",
    "season": "DJF",
    "uncertainty_m": 24.67,
    "status": "passed",             // later: "rejected"
    "reject_reason": null,          // later: "flowline_intersections" | "length" | "curvature" | "area_change"
    "image": null                   // always null in v1: published traces get their scenes from images.json (§5.6)
  }
}
```
`status`, `reject_reason` and `image` are present from v1, so rejected data can be added later without changing the schema. Rejected traces will go in the same file (≲2× size), and the UI filters them by `status`. The trace-to-scene link is kept in `images/<glacier>/images.json` rather than here, so the imagery can change without a new data version.

### 5.3 `timeseries.json`
Stored by column rather than as one object per row, which makes it smaller and easy to plot:
```json
{ "glacier": "GID1", "source": "time_series_terminus_variation/GID1_all_S1_corrected.csv",
  "date": ["2013-03-30", …], "t": [2013.2409, …],
  "length_change_m": [0.0, 36.7114, …], "area_change_raw": [0.0, 0.017, …], "area_unit_raw": "10 km2" }
```

### 5.4 `GID{n}_traces.gpkg` (download)
- Layer `traces`: full-resolution geometry (Z kept, original vertices), EPSG:4326.
- Columns: `trace_id`, `date` (DATE), `glacier_id`, `sensor` (code, e.g., `S1`), `season`, `uncertainty_m` (REAL), `status`.
- No separate glacier-metadata layer in v1 (it is in `glaciers.json`).
- Values are only converted (strings to dates and floats). Geometry is never modified.

### 5.5 `manifest.json`
```json
{ "schema": 1, "version": "v1", "generated": "…", "source_archive": { "Termini.zip": "<sha256>", … },
  "build": { "git_commit": "…", "simplify_tolerance_m": 5, "season_scheme": "meteorological" },
  "files": [ { "path": "glaciers.json", "bytes": 98213, "sha256": "…", "content_type": "application/json", "encoding": "gzip" } ] }
```

### 5.6 `images/<glacier>/images.json`
Gzipped, one per glacier, at `<DATA_BASE_URL>/images/GID1/images.json`. Sizes: 1.5 KB to 132 KB gzipped, median 24 KB.
```jsonc
{ "glacier": "GID278",
  "scenes": [ {
    "id": "LT05_008011_19850610",                 // Earth Engine scene id
    "date": "1985-06-10", "sensor": "L5",
    "image": "GID278/LT05_008011_19850610.avif",  // relative to images/: the URL is <DATA_BASE_URL>/images/<image>
    "corners": [[-50.11899, 69.26891], [-49.47322, 69.28686], [-49.43613, 69.1058], [-50.07659, 69.08803]],
                                                  // lon/lat: top-left, top-right, bottom-right, bottom-left (MapLibre image source order)
    "traces": ["GID278_19850610_L5"]              // trace ids from traces.geojson drawn on this date and sensor
  } ] }
```
- Every scene links to at least one trace. To find a trace's scenes, invert `traces` once when the file loads.
- **Planned additions,** which only need the indexes rebuilt and re-uploaded:
  - each scene's `tier` (Landsat `T1`/`T2`, for the Tier 2 label);
  - the data version the links were built from.

---

## 6. Data prep pipeline (`prep/`)

```
prep/
  pyproject.toml          deps: pyogrio (read .shp, write .gpkg), shapely>=2, pyproj; dev: pytest
                          (CSV/JSON/gzip/hashing use the standard library)
  build.py                CLI + build(): extract the zips to a temp dir, build every glacier, validate, write glaciers.json + manifest
                          build.py --src ~/Downloads/autoterm_data --out dist-data/v1 --version v1  (--out must be empty or missing)
  autoterm/
    glaciers.py           ID + uncertainty CSV parsing, encoding/BOM/blank-row cleanup, ROI handling
    traces.py             read shapefiles, group by per-trace label, merge duplicates, normalize, trace IDs, season
    output.py             simplify + write display GeoJSON, full-resolution GPKG, gzipped JSON
    pipeline.py           build one glacier's files and its glaciers.json entry
    timeseries.py         parse CSV, write JSON + CSV
    derive.py             length-change trend, counts (season is in traces.py)
    manifest.py           hashing, manifest, per-file header metadata
  upload.sh               rclone sync + header setting, then latest.json switch
  tests/                  pytest: synthetic fixtures per module, build() on a synthetic archive, one real-archive test
```

### 6.1 Steps
1. **Index.** Parse `Glacier Identification.csv` and `uncertainty_all.csv` (utf-8-sig, blank rows dropped, `#N/A` → `null`), joined on glacier number.
2. **Traces, one glacier at a time** (after the zips are extracted to a temp dir; the biggest file is ~65 MB):
   - Group by per-trace glacier label (§3 item 8), merge exact duplicates, normalize attributes, assign trace IDs (own file first, so they are stable).
   - Write the full-resolution GPKG.
   - Simplify (5 m, EPSG:3413), check the deviation from the originals, and write `traces.geojson`.
   - Compute counts and bbox.
3. **Time series.** Parse each CSV and write `timeseries.json` and the download CSV.
4. **Derived fields** (§6.3, §6.4).
5. **Gzip** JSON/GeoJSON in place (the file name stays the same; the upload sets `Content-Encoding`). CSV and GPKG downloads are not gzipped.
6. **Manifest** with sizes, hashes and header metadata.
7. **Validate** (§6.2). `--out` must be empty or missing, and unknown glacier ids fail before anything is extracted.

### 6.2 Invariants (build fails if violated)
- 295 glaciers when building everything (not checked for a `--glaciers` subset).
- Display trace count = full-resolution count = counted traces, per glacier. Reconciling with the source row count (kept + merged) is done from the build log.
- Every display file is under 5 MB gzipped.
- No duplicate trace IDs once suffixes are applied; every collision is logged.
- Every sensor value maps to `L5|L7|L8|S1|S2`.
- Every date parses and the glacier's date range falls within 1984–2022.
- The simplified geometry stays within 6 m of the original (5 m tolerance + ~1 m coordinate rounding; Hausdorff distance on a sample). Measured on GID1 and GID100: worst 5.3 to 5.4 m.

### 6.3 Season
Default: **meteorological** seasons, DJF / MAM / JJA / SON (December is counted with the following winter's DJF). Stored per trace and counted per glacier. The scheme name goes in the manifest so a melt/non-melt scheme can be added later without ambiguity (§11 Q2).

### 6.4 Length-change trend
- **v1:** ordinary least-squares slope of `length_change_m` against decimal year over the provided series (2013 to 2020/21), in m/yr, exactly as given in the source. Stored with its period, method name and n, and labelled with its period in the UI so it isn't read as the long-term rate.
- **No advance/retreat label or category in v1.** The sign convention of the source column is unconfirmed (§3 item 14, §11 item 9), so the viewer shows the raw slope and lets users sort and filter by value. Categories can be added once the authors confirm the sign.
- **Later:** a rate over the full 1984–2021 record, computed from the traces themselves. Use the reference polygon from `reference_polygon_new_ID.zip`: area between each trace and the reference polygon, divided by the mean width. That is the standard box method, and it matches how the provided series was derived (an assumption to confirm). The result goes in as a second entry beside `length_trend`; the v1 entry is not replaced.

### 6.5 Running it
Full rebuild is local and takes a few minutes (3.4 GB output; extracting the 3 GB of shapefiles is a large part). `--glaciers GID1,GID2` rebuilds a subset during development. Output in `dist-data/` is git-ignored. The manifest records `git describe --always --dirty`, so build from a clean, committed tree before uploading.

---

## 7. Upload (`prep/upload.sh`)
```bash
prep/upload.sh --remote r2:BUCKET --version v1 [--src dist-data] [--dry-run] [--force]
```
- Uses `rclone` with an R2 remote (S3-compatible). The credentials live in your rclone config or environment and never go in the repo or the script. The remote needs `no_check_bucket = true` (or the script's `--s3-no-check-bucket`) when the token is scoped to one bucket.
- **Credentials:** the Access Key ID (32 hex characters) and Secret Access Key (64) from an R2 API token with Object Read & Write on this bucket; the endpoint is `https://<account-id>.r2.cloudflarestorage.com`. A bucket-scoped token is denied `rclone lsd`; test with `rclone lsf r2:BUCKET` instead.
- Uploads to `autoterm/<version>/` in four passes, one per file type, each with the §4.2 headers: `*.geojson` and `*.json` (gzip), `*.csv`, `*.gpkg` (`Content-Disposition: attachment`). All use `Cache-Control: immutable` and rclone's `--immutable`.
- Order: upload the version → `rclone check` against the local build (hashes) → **then** write `autoterm/latest.json` (`max-age=60`). A failed check leaves `latest.json` alone, so a partial upload is never live.
- Refuses to upload when `autoterm/<version>/` already has objects, unless `--force`. `--dry-run` shows the copies and skips the check and `latest.json`.
- Tested with a stub `rclone` (header groups, refusal, ordering, failed check, dry run). The real bucket is verified by hand after the first upload (below).

### After the first upload (manual)
With the bucket's `r2.dev` URL enabled and the §4.3 CORS policy applied (done for `v1`, all checks passed; results below):
```bash
curl -sI https://<bucket>.r2.dev/autoterm/v1/glaciers/GID1/traces.geojson   # content-type, content-encoding: gzip, cache-control
curl -s  https://<bucket>.r2.dev/autoterm/latest.json
docker run --rm web-view-browser probe.py http https://<bucket>.r2.dev/autoterm/v1/glaciers.json   # parses as JSON
curl -sI -H "Origin: https://autotermlab.github.io" https://<bucket>.r2.dev/autoterm/latest.json | grep -i access-control
```
Findings from the `v1` upload:
- All 1,173 files in `manifest.json` match the bucket (size, content type, encoding, cache header). Check with HEAD requests sent **sequentially**: `r2.dev` returned HTTP 429 for 563 of 1,173 requests sent 16 at a time. A TLS handshake timeout can also occur; retry.
- Pre-gzipped objects are served unchanged to clients that send `Accept-Encoding: gzip` (browsers do), with `Content-Encoding: gzip`; other clients get them decompressed.
- Cloudflare rejects Python's default `urllib` User-Agent (error 1010) on `r2.dev`. `probe.py` now sends a browser-like User-Agent; browsers and `curl` are unaffected.
- CORS: allowed origins get `Access-Control-Allow-Origin` and the exposed headers; `Range` preflight returns 204; other origins get no CORS headers.

---

## 8. Frontend (`app/`)

### 8.1 Structure
```
app/
  index.html
  vite.config.ts            base: '/web-view/' for GitHub Pages
  src/
    main.ts                 bootstrap: fetch latest.json → glaciers.json, init router
    config.ts               DATA_BASE_URL (env: VITE_DATA_BASE_URL), defaults to https://autoterm.bandicoots.net/autoterm
    data.ts                 typed fetchers + in-memory cache; one place that knows the bucket layout (versioned data and images/)
    types.ts                TS types mirroring §5 schemas
    state.ts                filter state ↔ URL query string (shareable links)
    views/
      overview.ts           Greenland map + glacier table
      glacier.ts            detail: trace map, time series, trace inspector, downloads
    components/
      filters.ts            sensor chips, season chips, trend-slope range, year range
      table.ts              sortable glacier table
      traceMap.ts           MapLibre layer setup, data-driven styling, hover/click
      timeseries.ts         Observable Plot chart
      coverage.ts           year × sensor heatmap (from counts.by_year_sensor)
    styles.css
```

### 8.2 Views
**Overview (`#/`)**
- **Built so far** (`feature/overview-map`, `docs/update-plan.md` §1): the map, one neutral-coloured marker per glacier sized by trace count, names from zoom 5, a hover popup (name, GID, traces) and click-through to the glacier. The table is at `#/list`, linked both ways, as the keyboard and screen-reader route. Trend colouring and the filters are still to come.
- Map of Greenland with one marker per glacier, colored by trend slope (neutral diverging scale, no advance/retreat wording) and sized by trace count. Basemap (all views): OpenFreeMap's "Positron" style, a plain light-grey map from OpenStreetMap data (no API key, attribution shown). If its style can't be fetched, a blank background is used, so the data still shows.
- Table with columns: ID, name, length-change trend, traces, date range, uncertainty. Sortable. The map and table filter together.
- Filters: trend-slope range; minimum trace count for the selected sensors/seasons (e.g., "glaciers with ≥50 winter S1 traces"). Everything is computed from `glaciers.json` with no extra fetches.

**Glacier detail (`#/glacier/GID1?sensor=S1,S2&season=DJF`)**
- Fetches `traces.geojson` and `timeseries.json` for that glacier (2 requests).
- Map: traces colored by date (sequential color scale) or by sensor (toggle). Filtering by sensor, season and year range uses MapLibre `setFilter`, which needs no reload.
- Clicking a trace opens the inspector: date, sensor, season, uncertainty, status, and the scene it was drawn on.
- **Source imagery:**
  - **Loading:** fetches `images/<glacier>/images.json` with the traces, as a third request. A preview loads only when a trace is selected, never all of a glacier's scenes at once, which can be up to 7,633. This keeps requests well under the `r2.dev` rate limit.
  - **Display:** the preview is warped into Web Mercator (§4.5) and shown as a MapLibre `image` source, drawn under the traces and over the basemap, with an opacity slider. The basemap stays visible through the transparent no-data area.
  - **More than one scene for a trace:** ranked by the share of the trace's vertices inside each scene, best first, and the share is shown ("Holds 62% of the trace"). Some linked scenes are slivers at the edge of the glacier box that miss the trace entirely, e.g. GID85 1985-04-20. The user can step through them.
  - **Trace with no scene** (5 in v1): "No scene available for this date".
  - **Labels:** "Landsat Tier 2: may be offset by tens of metres" on those scenes, once `images.json` has the tier (§5.6); scene id, date and sensor on every preview.
- Time series: length change against date, with the OLS trend line and slope. The source series has no sensor or trace column, so points are neutral (not colored by sensor) and are linked to the map by date, best effort: hover or click highlights the trace(s) on that date, and a point with no trace on its date (about 2% of rows) highlights nothing.
- Coverage heatmap of traces per year by sensor (manuscript Fig. 9 style).
- **Downloads panel:** full-resolution GPKG and time-series CSV, with file sizes from the manifest. These are plain links to R2, so nothing passes through the app.

**Rejected traces (later):** a `status` filter (passed / rejected / both); rejected traces drawn dashed in red; the inspector shows `reject_reason` and the thumbnail. The UI hooks are present but hidden while `rejected_count` is `null`.

### 8.3 Behavior details
- All filter state lives in the URL, so views are shareable and the back button works.
- Hash routing (`#/…`) avoids GitHub Pages 404 problems with deep links.
- Network errors: a clear message, a retry button, and the error never blanks the whole app.
- Accessibility: keyboard-navigable table and filters; color scales checked for color-vision deficiency. Sensor colors stay the same across map, chart and heatmap.
- Works at phone width (map above, panels stacked below).

### 8.4 Testing
- **Prep (`pytest`):** unit tests run on tiny synthetic fixtures built inside the test (a few LineStrings and CSV rows), so tests never need the raw archive. A separate integration test runs `build.py --glaciers GID1` against the real archive and is skipped when `/home/oxygen/Downloads/autoterm_data/` is absent.
- **App (Vitest):** pure logic only, such as filters, URL-state round-trip, season labels and data path building. Fixtures are small JSON files matching §5.
- **Visual (`tools/browser/`):** `probe.py console` (no errors, no failed requests) and `shot.py` screenshots of the overview and a glacier detail view; `glacier-timing.js` times opening a glacier (§12), run against `vite preview` with a local `dist-data/` subset. Run before the final merge only (see CLAUDE.md).

---

## 9. Deployment
- `.github/workflows/pages.yml`: on push to `main` → `npm ci` → `npm run build` (in `app/`) → `actions/deploy-pages`.
- `VITE_DATA_BASE_URL` comes from a repo variable, so switching from `r2.dev` to a custom domain needs no code change.
- The workflow never touches data; data releases are the separate local `build.py` + `upload.sh` flow.

---

## 10. Milestones

Each milestone is built on its own branch and merged after review. Update the Status column when a milestone is merged.

| # | Milestone | Branch | Done when | Status |
|---|---|---|---|---|
| M0 | **Bucket spec signed off** (§4–5) | `feature/project-setup` | Plan reviewed; the developer creates the R2 bucket, `r2.dev` URL and CORS policy (not needed until M2) | **Done** (bucket, `r2.dev` URL and CORS in place) |
| M1 | Prep pipeline on 3 glaciers | `feature/prep-pipeline` | `build.py --glaciers GID1,GID2,GID100` produces valid output; tests pass | **Done** (full 295-glacier build also verified; rebuild from a clean tree for M2) |
| M2 | Full build + upload | `feature/upload` | All 295 glaciers built, invariants pass, `v1/` uploaded, `manifest.json` checked from the public URL | **Done** (`v1` uploaded 2026-10-22 from commit `958c5dc`; all 1,173 files verified against the manifest, §7) |
| — | Imagery for published traces (one-off, `docs/imagery-procedure.md`) | `feature/previews` (others archived) | A scene and a linked preview for every published trace the data allows; uploaded and checked | **Done** (218,464 of 218,469 traces; uploaded 2026-11-04, full `rclone check` clean) |
| M3 | App skeleton + overview | `feature/app-overview` | Deployed to Pages, loads `glaciers.json` from R2, map + table + filters work | **In progress** (map and table done on `feature/overview-map`; filters and the Pages deploy to come) |
| M4 | Glacier detail | `feature/glacier-detail` | Trace map, sensor/season/year filters, time series, inspector, downloads | **In progress** (trace map, scene stepping, sensor and season filters, coloring by season, coverage chart, resizable panel done; downloads in `docs/update-plan.md`) |
| M5 | Polish | `feature/polish` | URL state, error states, mobile layout, accessibility pass, README (data citation + how to rebuild) | — |
| Later | Rejected images · full-record length-change trend · Greenland-wide PMTiles · ice-mask COGs · custom domain | — | — | — |

---

## 11. Open questions
Already decided: start on `r2.dev`, then the custom domain (moved 2026-11-04); host full-resolution downloads (§2). For everything below, build with the stated default until the developer answers.

1. **Trend period:** is v1's 2013–2021 slope acceptable, with the full-record trend as a later item? (Assumed yes.)
2. **Season scheme:** meteorological (assumed), or melt/non-melt? Can both be offered?
3. **ROI repair:** is there a clean copy of `Glacier Identification.csv`? If not, is "space → `0`" the right repair? (Assumed: ROI is `null` until confirmed; it isn't needed for v1 features.)
4. **Area unit:** the time series column is labelled `10 km2`. Is that km² × 10, or a typo for `km2`? (v1 avoids it and plots length.)
5. **Official archive:** is AutoTerm published elsewhere (e.g., Zenodo)? The viewer should cite and link it alongside our downloads.
6. **Version retention:** keep every version, or only the latest two?
7. **Rejected-image source:** when available, what form will it take (rejected traces as shapefiles plus source images from GEE)? This decides whether the thumbnail step belongs in this pipeline.
8. **GID262 (for the dataset authors):** why do `GID262.shp` and the GID262-labeled traces in `GID266.shp` share 379 (date, sensor) pairs with different geometry? Are they distinct picks or one is wrong? (Default: keep both.) See §3 item 9.
9. **Time series sign and quality (for the dataset authors):** is positive `Change in length (m)` advance or retreat? With negative = retreat, 120 of 291 glaciers come out "advancing" (>25 m/yr) and 52 retreating, which looks high for Greenland; flipping the sign gives the opposite. Zachariæ Isstrøm (GID102) shows +1.8 km by 2015, though that glacier retreated. Also: should the four series with absurd values (GID94, 100, 101, 215) be excluded? And is a robust slope (Theil–Sen) preferred over least squares? A robust slope would change the advance/retreat class of 17 of 291 glaciers if classes were used. (Default: least squares, raw slope, no label.)

## 12. Risks
| Risk | Mitigation |
|---|---|
| `r2.dev` rate limits during heavier use (observed: HTTP 429 when 16 parallel requests were sent; Cloudflare publishes no number). Previews add many small requests | Load previews one at a time, on trace selection (§8.2). **Done 2026-11-04:** moved to the custom domain `autoterm.bandicoots.net`, with a Cache Rule making every file on it eligible for cache (JSON/GeoJSON/GPKG aren't in Cloudflare's default cached extensions). Checked 2026-11-04: gzip passes through, CORS allows both origins and no others, and files match `dist-data/` byte for byte. Every file type (JSON, GeoJSON, GPKG, CSV, AVIF) is cached: `MISS`, then `HIT`. Cloudflare keeps a separate cached copy per `Origin` and `Accept-Encoding` (`Vary`), so CORS headers stay correct, and clients that don't accept gzip get plain JSON |
| Basemap tiles are slow the first time a glacier is opened: OpenFreeMap's Cloudflare cache is cold for most of Greenland, so a tile takes 1–6 s, then about 0.05 s once cached | Keep OpenFreeMap and its cache (decided 2026-11-04; self-hosting a Greenland PMTiles extract was rejected as not worth the complexity). The data doesn't wait for the basemap: the map is created as soon as `glaciers.json` is in, while the traces download, and layers are added on `style.load`, not `load`, which waits for every tile on screen. Measured on glaciers not opened before (`tools/browser/glacier-timing.js`): before, traces 3.5–6.5 s and scene 3.7–6.7 s (GID40, 120, 250); after, traces 0.27–0.36 s and scene 0.53–0.56 s, with the basemap filling in up to 3 s (GID60, 140, 260) |
| Large glaciers make the detail view slow on mobile | Measure in M4; if needed, raise the tolerance or split traces per decade (layout allows extra files) |
| Source attribute inconsistencies in some of the 295 files | Invariants in §6.2 fail loudly; fixture tests for each problem found |
| ~~`r2.dev` may not pass pre-gzipped objects through unchanged~~ | Verified OK on `v1` (§7): served with `Content-Encoding: gzip` to clients that accept it |
| Misread trend (2013–2021 shown as long-term, or sign read backwards) | Period shown next to every slope, no advance/retreat wording until the sign is confirmed; method stored in data |
