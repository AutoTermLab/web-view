# AutoTerm Web Viewer — Implementation Plan

Status: accepted for development · 2026-10-22. Where §11 is still open, build with the stated defaults.

A static web app, hosted on GitHub Pages, for browsing and inspecting the AutoTerm Greenland glacier terminus dataset (Zhang et al., 2023, *The Cryosphere* 17, 3485–3503). The data lives in a Cloudflare R2 bucket and is fetched piece by piece. The app never downloads the full archive.

---

## 1. Goals and scope

### v1
- Browse all 295 glaciers on an overview map and in a sortable, filterable table.
- Organize and filter by **sensor** (Landsat 5/7/8, Sentinel-1/2), **season**, and **retreat rate**.
- Glacier detail view: terminus traces on a satellite basemap, colored by date or sensor, plus a time series of terminus change.
- Per-trace inspection: date, sensor, uncertainty, and status.
- Download individual sets through the viewer: full-resolution traces per glacier (GeoPackage), plus the per-glacier time series (CSV).

### Later (designed for now, not built in v1)
- **Images that failed screening.** View rejected traces and their source-image thumbnails, with the reason for rejection. The data isn't available yet. The schema and bucket layout reserve space for it (§4.3, §5.2), so adding it requires no restructuring.
- Retreat rate over the full 1984–2021 record (§6.4).
- Greenland-wide trace overview (PMTiles) and ice-mask overlays (COG).

### Non-goals
- No server or backend. Everything is static files on GitHub Pages plus R2.
- No editing or curation of the data.

---

## 2. Decisions so far

| Topic | Decision |
|---|---|
| Hosting (app) | GitHub Pages, deployed by GitHub Actions |
| Hosting (data) | Cloudflare R2. Starts on `r2.dev`; a custom domain may come later. Only `DATA_BASE_URL` changes when it does |
| Data organization | Small files per glacier at predictable paths, under an immutable versioned prefix (§4) |
| Resolution | **Both.** Simplified traces for display, plus full-resolution GeoPackage per glacier for download. Revisit only if performance becomes a problem |
| Storage budget | Under 10 GB total (R2 free tier) |
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
| `reference_polygon_new_ID.zip` | Reference polygon per glacier (used to build training labels) | Full-record retreat rate (later, §6.4) |
| `Icemask.zip` | GrIMP-based masks 2018–2020, 15 m GeoTIFF | Later (COG overlay) |
| `label_shape_TermPicks.zip` | TermPicks training labels | Not used |

### Known data issues (the build must handle these)
1. `Glacier Identification.csv` is Latin-1/cp1252 encoded (`Bjørk`, `Isbræ`).
2. **ROI strings look corrupted.** Digits seem to have been replaced by spaces (`"[-51.76,71.7 8,-51.52,71.777]"`). Repair rule TBD (§11 Q3). Until it's settled, the ROI is stored as `null` with the raw string kept for reference.
3. `uncertainty_all.csv` has a BOM and ~700 trailing blank rows.
4. 3 glaciers have no time series, and 1 time series file has only a header. The build must allow a missing time series.
5. The zips contain `__MACOSX/` junk; skip it.
6. The time series area unit is labelled `10 km2`, which needs confirming against the manuscript or authors before area is shown in the UI. v1 charts use **length change (m)**, which is unambiguous.
7. Trace key uniqueness: `(glacier, date, sensor)` is unique for GID1. The build asserts this for every glacier (§6.2).

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
        images/                        (later) thumbnails, one per trace: {trace_id}.webp
      GID2/
      …
    overview/                          (later) traces.pmtiles
    icemask/                           (later) 2018.tif, 2019.tif, 2020.tif as COG
```

### 4.1 Conventions
- **Glacier key:** `GID{n}`, matching the source file names. Kept as a string so future tributary suffixes (`GID28a`, manuscript §5.5) need no schema change.
- **Trace ID:** `GID{n}_{YYYYMMDD}_{SENSOR}`, with sensor codes `L5 L7 L8 S1 S2`. Example: `GID1_20170209_S1`. If a collision occurs (e.g., two S1 passes on the same day), add a `_{k}` suffix starting at 2, and log it.
- **Versioning:** everything under `v{N}/` is write-once. A rebuild publishes `v{N+1}/` and then updates `latest.json`. Old versions stay in place for reproducibility while under the storage budget.
- **Relative paths everywhere:** JSON files refer to other files by paths relative to the version root (`glaciers/GID1/traces.geojson`). The app joins them with `DATA_BASE_URL` + version.

### 4.2 HTTP headers per file type

| Pattern | Content-Type | Content-Encoding | Cache-Control |
|---|---|---|---|
| `latest.json` | `application/json` | — | `public, max-age=60` |
| `v*/**/*.json`, `*.geojson` | `application/json` / `application/geo+json` | `gzip` (uploaded pre-compressed) | `public, max-age=31536000, immutable` |
| `v*/**/*.csv` | `text/csv; charset=utf-8` | `gzip` | immutable (as above) |
| `v*/**/*.gpkg` | `application/geopackage+sqlite3` | — (download as-is) | immutable, plus `Content-Disposition: attachment` |
| `v*/**/*.webp` | `image/webp` | — | immutable |
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
- About 3.5 GB per version, so two versions fit under 10 GB. If a third is needed, delete the oldest version or reuse unchanged downloads (§11 Q6).
- `r2.dev` is rate-limited and not CDN-cached. That's fine for development and light use; move to a custom domain before announcing the viewer publicly.

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
      "retreat": {
        "rate_m_per_yr": -120.0,            // illustrative value; negative = retreat
        "period": ["2013-03-30", "2021-05-28"],
        "method": "ols_length_change_2013_2021",
        "n": 941,
        "category": "moderate_retreat"
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
    "date": "2017-02-09",
    "t": 2017.1068,                 // decimal year, used for color scales
    "sensor": "S1",
    "season": "DJF",
    "uncertainty_m": 24.67,
    "status": "passed",             // later: "rejected"
    "reject_reason": null,          // later: "flowline_intersections" | "length" | "curvature" | "area_change"
    "image": null                   // later: "glaciers/GID1/images/GID1_20170209_S1.webp"
  }
}
```
`status`, `reject_reason` and `image` are present from v1, so rejected data can be added later without changing the schema. Rejected traces will go in the same file (≲2× size), and the UI filters them by `status`.

### 5.3 `timeseries.json`
Stored by column rather than as one object per row, which makes it smaller and easy to plot:
```json
{ "glacier": "GID1", "source": "time_series_terminus_variation/GID1_all_S1_corrected.csv",
  "date": ["2013-03-30", …], "t": [2013.2409, …],
  "length_change_m": [0.0, 36.7114, …], "area_change_raw": [0.0, 0.017, …], "area_unit_raw": "10 km2" }
```

### 5.4 `GID{n}_traces.gpkg` (download)
- Layer `traces`: full-resolution geometry (Z kept, original vertices), EPSG:4326.
- Columns: `trace_id`, `date` (DATE), `glacier_id`, `sensor` (original string, e.g., `Sentinel1`), `uncertainty_m` (REAL), `season`, `status`.
- Layer `glacier`: a single row of glacier metadata.
- Values are only converted (strings to dates and floats). Geometry is never modified.

### 5.5 `manifest.json`
```json
{ "schema": 1, "version": "v1", "generated": "…", "source_archive": { "Termini.zip": "<sha256>", … },
  "build": { "git_commit": "…", "simplify_tolerance_m": 5, "season_scheme": "meteorological" },
  "files": [ { "path": "glaciers.json", "bytes": 98213, "sha256": "…", "content_type": "application/json", "encoding": "gzip" } ] }
```

---

## 6. Data prep pipeline (`prep/`)

```
prep/
  pyproject.toml          deps: pyogrio (read .shp, write .gpkg), shapely>=2, pyproj; dev: pytest
                          (CSV/JSON/gzip/hashing use the standard library)
  build.py                CLI: build.py --src ~/Downloads/autoterm_data --out dist-data --version v1
  autoterm/
    sources.py            read zips without extracting everything (unzip one glacier at a time to a temp dir)
    glaciers.py           ID + uncertainty CSV parsing, encoding/BOM/blank-row cleanup, ROI handling
    traces.py             normalize attributes, trace IDs, simplify, write GeoJSON + GPKG
    timeseries.py         parse CSV, write JSON + CSV
    derive.py             season, retreat rate + category, counts
    manifest.py           hashing, manifest, per-file header metadata
  upload.sh               rclone sync + header setting, then latest.json switch
  tests/                  pytest: fixture glacier, schema checks, invariants
```

### 6.1 Steps
1. **Index.** Parse `Glacier Identification.csv` (cp1252) and `uncertainty_all.csv` (utf-8-sig, blank rows dropped), joined on glacier number.
2. **Traces, one glacier at a time** (memory stays bounded; the biggest is ~65 MB `.shp`):
   - Normalize attributes: strip padding, parse the date, map the sensor name to its code, parse uncertainty to float.
   - Assign trace IDs and check they're unique.
   - Write the full-resolution GPKG.
   - Simplify (5 m, EPSG:3413) and write `traces.geojson`.
   - Compute counts and bbox.
3. **Time series.** Parse each CSV and write `timeseries.json` and the download CSV.
4. **Derived fields** (§6.3, §6.4).
5. **Gzip** JSON/GeoJSON/CSV in place (the file name stays the same; the upload sets `Content-Encoding`).
6. **Manifest** with sizes, hashes and header metadata.
7. **Validate:** every path in `glaciers.json` exists, JSON matches the schema, trace counts in display = GPKG = source, and the largest display file is under 5 MB (gzipped).

### 6.2 Invariants (build fails if violated)
- 295 glaciers in the index, and each one has a traces file.
- No duplicate trace IDs once suffixes are applied; every collision is logged.
- Every sensor value maps to `L5|L7|L8|S1|S2`.
- Every date parses and falls within 1984–2022.
- The simplified geometry stays within 5 m of the original (checked with Hausdorff distance on a sample).

### 6.3 Season
Default: **meteorological** seasons, DJF / MAM / JJA / SON (December is counted with the following winter's DJF). Stored per trace and counted per glacier. The scheme name goes in the manifest so a melt/non-melt scheme can be added later without ambiguity (§11 Q2).

### 6.4 Retreat rate
- **v1:** ordinary least-squares slope of `length_change_m` against decimal year over the provided series (2013 to 2020/21), in m/yr, where negative means retreat. Stored with its period, method name and n, and labelled "2013–2021" in the UI so it isn't read as the long-term rate.
- **Categories** (default thresholds, adjustable after looking at the distribution):
  `advancing` > +25 · `stable` ±25 · `slow_retreat` −25 to −100 · `moderate_retreat` −100 to −300 · `fast_retreat` < −300 m/yr. Glaciers without a time series are `unknown`.
- **Later:** a rate over the full 1984–2021 record, computed from the traces themselves. Use the reference polygon from `reference_polygon_new_ID.zip`: area between each trace and the reference polygon, divided by the mean width. That is the standard box method, and it matches how the provided series was derived (an assumption to confirm). The result goes in as a second `retreat` entry; the v1 entry is not replaced.

### 6.5 Running it
Full rebuild is local and expected to take tens of minutes, dominated by reading 3.2 GB of shapefiles. `--glaciers GID1,GID2` rebuilds a subset during development. Output in `dist-data/` is git-ignored.

---

## 7. Upload (`prep/upload.sh`)
- Uses `rclone` with an R2 remote (S3-compatible; the credentials stay on your machine and never go in the repo).
- Uploads by file type so each group gets the headers from §4.2 (`--header-upload "Content-Encoding: gzip"` etc.).
- Order: upload `v{N}/` → read back and check `manifest.json` → **then** overwrite `latest.json`. A partial upload is never live.
- `--dry-run` flag; refuses to overwrite an existing `v{N}/` unless `--force`.

---

## 8. Frontend (`app/`)

### 8.1 Structure
```
app/
  index.html
  vite.config.ts            base: '/web-view/' for GitHub Pages
  src/
    main.ts                 bootstrap: fetch latest.json → glaciers.json, init router
    config.ts               DATA_BASE_URL (env: VITE_DATA_BASE_URL), defaults to r2.dev URL
    data.ts                 typed fetchers + in-memory cache; one place that knows the bucket layout
    types.ts                TS types mirroring §5 schemas
    state.ts                filter state ↔ URL query string (shareable links)
    views/
      overview.ts           Greenland map + glacier table
      glacier.ts            detail: trace map, time series, trace inspector, downloads
    components/
      filters.ts            sensor chips, season chips, retreat-category chips, year range
      table.ts              sortable glacier table
      traceMap.ts           MapLibre layer setup, data-driven styling, hover/click
      timeseries.ts         Observable Plot chart
      coverage.ts           year × sensor heatmap (from counts.by_year_sensor)
    styles.css
```

### 8.2 Views
**Overview (`#/`)**
- Map of Greenland with one marker per glacier, colored by retreat category and sized by trace count. Basemap: Esri World Imagery raster tiles (with attribution); fallback: OSM.
- Table with columns: ID, name, retreat rate, traces, date range, uncertainty. Sortable. The map and table filter together.
- Filters: retreat category; minimum trace count for the selected sensors/seasons (e.g., "glaciers with ≥50 winter S1 traces"). Everything is computed from `glaciers.json` with no extra fetches.

**Glacier detail (`#/glacier/GID1?sensor=S1,S2&season=DJF`)**
- Fetches `traces.geojson` and `timeseries.json` for that glacier (2 requests).
- Map: traces colored by date (sequential color scale) or by sensor (toggle). Filtering by sensor, season and year range uses MapLibre `setFilter`, which needs no reload.
- Clicking a trace opens the inspector: date, sensor, season, uncertainty, status, and (later) the image thumbnail.
- Time series: length change against date, points colored by sensor, with the OLS trend line and rate. Points are linked to the map: hover highlights, click selects.
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
- **App (Vitest):** pure logic only, such as filters, URL-state round-trip, season/category labels and data path building. Fixtures are small JSON files matching §5.
- **Visual (`tools/browser/`):** `probe.py console` (no errors, no failed requests) and `shot.py` screenshots of the overview and a glacier detail view, run against `vite preview` with a local `dist-data/` subset. Run before the final merge only (see CLAUDE.md).

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
| M0 | **Bucket spec signed off** (§4–5) | `feature/project-setup` | Plan reviewed; the developer creates the R2 bucket, `r2.dev` URL and CORS policy (not needed until M2) | Spec done; bucket pending |
| M1 | Prep pipeline on 3 glaciers | `feature/prep-pipeline` | `build.py --glaciers GID1,GID2,GID100` produces valid output; tests pass | **Next** |
| M2 | Full build + upload | `feature/upload` | All 295 glaciers built, invariants pass, `v1/` uploaded, `manifest.json` checked from the public URL | — |
| M3 | App skeleton + overview | `feature/app-overview` | Deployed to Pages, loads `glaciers.json` from R2, map + table + filters work | — |
| M4 | Glacier detail | `feature/glacier-detail` | Trace map, sensor/season/year filters, time series, inspector, downloads | — |
| M5 | Polish | `feature/polish` | URL state, error states, mobile layout, accessibility pass, README (data citation + how to rebuild) | — |
| Later | Rejected images · full-record retreat rate · Greenland-wide PMTiles · ice-mask COGs · custom domain | — | — | — |

---

## 11. Open questions
Already decided: start on `r2.dev` (custom domain later); host full-resolution downloads (§2). For everything below, build with the stated default until the developer answers.

1. **Retreat-rate period:** is v1's 2013–2021 rate acceptable, with the full-record rate as a later item? (Assumed yes.)
2. **Season scheme:** meteorological (assumed), or melt/non-melt? Can both be offered?
3. **ROI repair:** is there a clean copy of `Glacier Identification.csv`? If not, is "space → `0`" the right repair? (Assumed: ROI is `null` until confirmed; it isn't needed for v1 features.)
4. **Area unit:** the time series column is labelled `10 km2`. Is that km² × 10, or a typo for `km2`? (v1 avoids it and plots length.)
5. **Official archive:** is AutoTerm published elsewhere (e.g., Zenodo)? The viewer should cite and link it alongside our downloads.
6. **Version retention:** keep every version, or only the latest two?
7. **Rejected-image source:** when available, what form will it take (rejected traces as shapefiles plus source images from GEE)? This decides whether the thumbnail step belongs in this pipeline.

## 12. Risks
| Risk | Mitigation |
|---|---|
| `r2.dev` rate limits during heavier use | Move to a custom domain (config-only change) |
| Large glaciers make the detail view slow on mobile | Measure in M4; if needed, raise the tolerance or split traces per decade (layout allows extra files) |
| Source attribute inconsistencies in some of the 295 files | Invariants in §6.2 fail loudly; fixture tests for each problem found |
| Misread retreat rate (2013–2021 shown as long-term) | Period shown next to every rate; method stored in data |
