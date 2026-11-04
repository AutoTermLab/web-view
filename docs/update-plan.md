# Viewer update plan: overview map, season filter, coverage chart, downloads

Status: decisions taken 2026-11-04 (see the end); ready to build. Builds on `main` at `54a6302` (trace imagery viewer, Positron basemap).

Five features. Each gets its own branch, is reviewed, and is merged into `main` with `--no-ff`, in the order below. They cover parts of milestones M3 and M4 (`docs/implementation-plan.md` §10). When one merges, update that table.

## Summary

| # | Feature | Branch | Complexity | Confidence | New dependency |
|---|---|---|---|---|---|
| 0 | Serve the data from the custom domain instead of `r2.dev` | `feature/custom-domain` | Low | High | None |
| 1 | Overview map as the index page; table kept at `#/list` | `feature/overview-map` | Low–medium | High | None |
| 2 | Season filter in the glacier view | `feature/season-filter` | Low | High | None |
| 3 | Trace coverage over time (year × month) | `feature/coverage-chart` | Medium | High | None (hand-drawn SVG) |
| 4 | Download the traces as a zipped shapefile | `feature/trace-download` | Medium | High | None (own zip and shapefile writers) |
| 5 | Download the scene previews as a zip | `feature/image-download` | Medium–high | Medium | None (reuses the zip writer from 4) |

**Complexity** is the amount of new code and moving parts. **Confidence** is how sure I am that it works as described, first time, without surprises.

**Order:**
- 0 can go in any time once the domain is live; it must come before 5 is shared.
- 1 is independent.
- 2 comes before 3 so that the chart can follow the season filter.
- 4 builds the zip writer that 5 reuses.
- 5 goes last because it carries the most risk: the rate limit and memory use on large glaciers.

---

## 0. Custom domain (`feature/custom-domain`)

**Developer steps (Cloudflare dashboard):** connect a subdomain to the bucket under R2 → Settings → Custom Domains; add a Cache Rule for it; set the repo variable `DATA_BASE_URL`; allow the host in the sandbox firewall.

**Code (this branch):**
- Change the default `DATA_BASE_URL` in `app/src/data.ts`.
- Update the URL in `CLAUDE.md` and in plan §2, §7 and §12.

**Checks:**
- From the new host: headers, gzip pass-through, CORS for both origins, and `cf-cache-status` reading `HIT` on a second request.
- Browser probe on `#/` and a glacier.

Disable the `r2.dev` URL only after the deployed site has been switched over.

---

## 1. Overview map (`feature/overview-map`)

**What:** `#/` becomes a map of Greenland with one marker per glacier at its `lat`/`lon`. People recognise glaciers by where they are, not by their GID.
- Hovering a marker shows its name and GID.
- Clicking a marker opens the glacier view.
- The current table moves to `#/list`, unchanged. It stays the keyboard and screen-reader route.
- A visible "List of glaciers" link on the map page leads to the table, and the table links back.

**How:**
- One GeoJSON source is built from `glaciers.json`, which is already loaded, so no new requests are needed. All 295 glaciers have coordinates.
- The markers are a MapLibre `circle` layer, sized by trace count, with name labels at higher zoom.
- The map uses the same Positron basemap as the glacier view.
- `route.ts` gains `{view: "list"}` at `#/list`, and `#/` becomes `{view: "overview"}`. Old `#/` bookmarks still land on a page of glaciers.

**Kept out of scope:**
- **Colouring by length-change trend.** The plan calls for it, but the sign is unconfirmed (plan §11 Q9). The markers stay one neutral colour until then.
- **Map and table filters (M3).** They get a branch of their own later.

**Tests:**
- Vitest: the route round-trip for `#/`, `#/list` and the glacier route; the GeoJSON builder (count, coordinates, properties).
- Browser: a screenshot of `#/` and `#/list`, and a console probe.

**Risks:**
- In Web Mercator, north Greenland looks very large and glaciers on the coast overlap at low zoom. Circle layers handle this, with smaller radii at low zoom.
- Confidence is high: it reuses the map code already in `glacier.ts`.

---

## 2. Season filter (`feature/season-filter`)

**What:**
- Season chips (DJF, MAM, JJA, SON) in the glacier panel, next to the sensor chips.
- They filter the "other traces" layer, stepping through traces (previous and next) and the trace count.
- The selection goes in the URL (`?season=JJA`), so a view can be shared.

**How:**
- Every trace already has `season`, using meteorological seasons (plan §6.3), so no data change is needed.
- `visibleTraces(traces, sensors)` in `scenes.ts` gains a seasons argument.
- The map layer uses the same filter expression as the sensor filter.

**Caveat to show in the UI.** This is a data limit, not a code limit: 98% of winter (DJF) traces are from 2015 or later, and 88% are Sentinel-1. Before 2015 there are 493 DJF traces across all 295 glaciers. Optical sensors see nothing during the polar night. Comparing summer with winter therefore means comparing 2015 onward, and largely radar against optical. A short note under the chips says so.

**Tests:**
- Vitest: `visibleTraces` with seasons; the URL round-trip.
- Browser: GID85 with `season=DJF`, checking the count and that the console is clean.

**Decided:** the four meteorological seasons only. A custom month range (for example a May–September melt season, plan §11 Q2) may come later; it is a filter on the month of `date`, so this design leaves room for it.

---

## 3. Coverage over time (`feature/coverage-chart`)

**What:**
- A compact year × month grid in the glacier panel, covering 1984–2022.
- Each cell is shaded by the number of traces in that month.
- Empty cells are visibly empty, so the gaps stand out: the thin Landsat-only years before 2013 (about 1,000–3,000 traces a year across all glaciers, against 20,000–30,000 from 2016), the polar-night winters and the start of Sentinel-1 in 2015.
- Hovering a cell gives its count by sensor. Clicking a cell selects the first trace in that month.
- The grid follows the sensor and season filters. Months filtered out by season are dimmed rather than hidden, so the seasonal pattern stays readable.

**How:**
- The grid is computed from the `traces.geojson` already in memory, as a pure function `coverage(traces) → counts[year][month][sensor]`.
- It's drawn as plain SVG: 39 × 12 cells, about 100 lines.
- Plan §2 lists Observable Plot, but it isn't installed. A grid this simple doesn't need it, so no dependency is proposed.

**Tests:**
- Vitest: `coverage()` on a small fixture, including December assignment and filtered counts.
- Browser: GID85 and GID278 screenshots.

**Risks:** a few, all manageable.
- **Colour scale:** a sequential scale on a log or square-root count, since counts per month range from 1 to more than 100. It needs a colour-vision check (plan §8.3).
- **Phone width:** 39 columns become about 8 px wide in a 22 rem panel. That's readable, and the grid scrolls sideways if needed.

---

## 4. Trace download as a zipped shapefile (`feature/trace-download`)

**What:**
- A "Download traces (shapefile, .zip)" button in the glacier panel.
- Next to it, a direct link to the full-resolution GeoPackage, which is already in the bucket (`files.download_traces`) but not yet linked from the app.

**Decided: option A** (the viewer's geometry, built in the browser). The other options are kept for reference.

| Option | Geometry | Storage | Work | Confidence |
|---|---|---|---|---|
| **A (recommended)** Built in the browser from the loaded `traces.geojson` | Simplified display geometry, within 6 m of the original (plan §6.2) | None | Shapefile writer (`.shp`, `.shx`, `.dbf`, `.prj`, `.cpg`) and a zip writer, about 200 lines in total | High |
| B Built in the browser from the GeoPackage | Full resolution | None | Needs `sql.js` (about 1 MB WebAssembly), a new dependency, plus GeoPackage geometry parsing | Medium |
| C Pre-built by `prep/` and uploaded | Full resolution | Roughly +1–3 GB, past the 10 GB free tier (now 9.97 GB), about $0.015 per GB-month over | Prep step, upload, and a path not listed in the immutable `glaciers.json`, so the app has to build it by convention | High, but costs storage and an upload |

**Why A:**
- It downloads nothing extra and is instant.
- Full resolution stays one click away as the GeoPackage, which QGIS and ArcGIS Pro open directly.
- A small exclamation icon next to the button shows, on hover: "Simplified display geometry, within 6 m of the original. For full resolution, download the GeoPackage." The icon is also focusable, so the message shows on keyboard focus and on tap (a hover-only tooltip would hide it from keyboard and touch users).
- The zip includes the same message as a `README.txt`, so it travels with the file.

**Shapefile details:**
- Geometry type PolyLine, in EPSG:4326, with a `.prj` (WGS84 WKT) and a `.cpg` (UTF-8).
- DBF fields, which are limited to 10 characters: `trace_id`, `date` (D), `sensor`, `season`, `uncert_m`, `status`.
- The download follows the current sensor and season filters, so the file name records them (for example, `GID85_traces_S1-S2_DJF.zip`).
- The zip uses the store method (no compression) with CRC-32. `CompressionStream("deflate-raw")` can shrink it later if needed.

**Tests:**
- Vitest: the zip writer's CRC-32 against known values; the shapefile header and record lengths on a two-trace fixture.
- Round trip: a test script reads the zip with `pyogrio` (`uv run`), which is already a prep dependency. It checks the count, the fields and that every vertex matches.
- Browser: click the button and check that a file is produced (the probe captures the blob size).

**Risks:**
- The largest glacier's display traces are 3.1 MB gzipped, about 20–30 MB as a shapefile, which is fine in memory.
- The shapefile format itself is well documented. The format's own limits (2 GB, 10-character field names) don't apply here.

---

## 5. Scene preview download as a zip (`feature/image-download`)

**What:** a "Download scenes (.zip)" button for the previews of the currently filtered traces.

**Contents of the zip:**
- **The AVIF previews, unchanged,** so the zip holds the same images the viewer shows.
- **A world file (`.wld`) and a `.prj` for each image,** in the scene's own UTM zone. Both come from the corners, using the `inferZone` and `toUtm` already in `warp.ts`, so GIS software can place the image.
- **A `scenes.csv`** with scene id, date, sensor, UTM zone, corners and linked trace ids.

**Scale:**

| Per glacier | Median | 90th percentile | Max (GID91) |
|---|---|---|---|
| Previews | 1,028 | 1,677 | 7,633 |
| Size | 8 MB | 37 MB | 675 MB |

**Rate limit:** each preview is a separate request. `r2.dev` returned HTTP 429 at 16 parallel requests (plan §12), so the download fetches 2–4 at a time and backs off on 429.

**Time:** at roughly 10 files per second:

| Case | Time |
|---|---|
| Median glacier | about 2 minutes |
| Largest glacier | about 13 minutes |

**UI:**
- A progress bar and a Cancel button.
- A warning above roughly 1,000 scenes, suggesting a narrower filter.

**Memory:** the zip is built from `Blob` parts, which browsers can spill to disk. 675 MB works in desktop Chrome and Firefox. It may fail on phones, so the button is hidden at phone width.

**Decided: A,** in the browser, as above, sized by the filters. It needs no storage and no upload. For reference, the rejected alternative:
- **(B)** Pre-built zips, one per glacier, in R2. That's +6.5 GB, so the total reaches about 16.5 GB, about $0.10 a month over the free tier. Each one is a single request and fast, but it's a large upload and doesn't follow the filters.

**Confidence is medium,** for three reasons:
- **Rate limit:** `r2.dev` limits aren't published. The move to the custom domain (feature 0) removes the concern and comes before this is shared.
- **GIS support for AVIF:** QGIS reads AVIF only when its GDAL build has the AVIF driver. That's true in recent QGIS on Windows and macOS, uncertain on Linux distribution builds. Fallback: convert to PNG in the browser through a canvas. That's lossless from the decoded preview, but files are several times larger and it takes longer.
- **World files:** they need checking in GDAL/QGIS. A `.wld` is recognised generically, but I'll verify that GDAL picks it up for `.avif` and that the placement matches the trace.

**Tests:**
- Vitest:
  - the world-file maths against a UTM rectangle (reusing the `warp.test.ts` fixture);
  - the CSV rows;
  - the backoff logic with a stubbed `fetch` returning 429.
- Manual check: open one downloaded scene and its traces in QGIS and confirm they line up. I can check placement with GDAL in the sandbox, but not visually in QGIS.
- Browser: download from a small glacier (GID278) and check the zip's entry count.

---

## Before the final merge of each branch

Run the full suite:
- `uv run pytest` (prep);
- `npm test` and `npm run build` (app);
- the browser probe and screenshots on `#/`, `#/list`, GID278 and GID85.

## Decisions (2026-11-04)

1. **Shapefile geometry:** A, the viewer's simplified geometry, built in the browser. A hover/focus icon explains it (§4).
2. **Image zip:** A, built in the browser and limited by the filters (§5).
3. **Seasons:** the four meteorological seasons only, for now. Custom months may come later (§2).
4. **Custom domain:** yes, before feature 5 is shared (§0).
