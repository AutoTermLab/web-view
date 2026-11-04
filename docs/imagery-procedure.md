# Procedure: imagery for the published traces

How the scenes and previews behind the v1 traces were made (October 27 to November 3, 2026), so the work can be repeated or extended. This was a one-off job. Apart from the preview builder, the code is not on `main`; it is kept on archive tags (see "Where the code is").

## Result

| | |
|---|---|
| Traces covered | 218,464 of 218,469 have a scene on their date and sensor, and a linked preview |
| Not covered | 5 traces, all Landsat 5, with no scene that day in Earth Engine: GID97 1988-05-23, GID100 and GID101 1993-08-24, GID285 and GID286 1993-06-28. Only the authors' archive has them |
| Scenes | 352,118 zips, 400.3 GB: S2 172,264, S1 68,414, L8 50,965, L7 38,831, L5 21,596. In `/home/oxygen/Downloads/autoterm_data/scenes/GID<n>/<sensor>/<scene>.zip` |
| Previews | 352,062 AVIFs plus one `images.json` per glacier: 6.09 GiB and 7.2 MiB as rclone counts them (6.8 GB on disk by `du`), in `dist-data/images/`. Live on R2 at `autoterm/images/` since 2026-11-04 (step 8) |

**Caveats for the viewer:**
- About 3,500 traces rely on Landsat Tier 2 scenes. For L5 these sit further from the traces (median 30 m against 15 m for Tier 1, and 31% beyond 60 m against 8%), with no common direction. Label them; don't present them as precisely aligned.
- GID85's large scenes are clipped to the area around that day's traces (plus 2 km). Most of its S1 and S2 scenes are at 20 m instead of 10 m.

## Where the code is

| Tag | What it holds |
|---|---|
| `archive/imagery-2026-11/rois` | `prep/write_rois.py`, `prep/autoterm/rois.py`, tests, and the working plan with the full history and numbers (`docs/published-trace-imagery-plan.md`) |
| `archive/imagery-2026-11/gee-downloader` | `tools/gee/download.py`, `listing_misses.py`, `benchmark.py`, tests |
| `archive/imagery-2026-11/coverage-check` | `prep/coverage_check.py`, `prep/autoterm/coverage.py`, tests |
| `archive/imagery-2026-11/overlay-check` | `prep/overlay_check.py`, `prep/autoterm/overlay.py`, tests |
| `archive/imagery-2026-11/previews` | `prep/build_previews.py`, `prep/autoterm/previews.py`, tests (to be merged into `main`: it is needed again whenever `images.json` or the preview format changes) |

To use them, check a tag out beside the main checkout:

```bash
git worktree add ../web-view-imagery archive/imagery-2026-11/gee-downloader
```

Tests: `cd prep && uv run pytest` for `prep/`, and `cd prep && uv run pytest ../tools/gee` for the Earth Engine tools.

## Who runs what

- **The developer's machine:** the Earth Engine steps (2, 4, 5). They need the Earth Engine login and project `autoterm-509520`. Use the venv in `tools/gee/.env` (`earthengine-api`), and run from `tools/gee/`: `download.py` imports `benchmark.py` from there and reads the traces from `../../dist-data/v1`.
- **The sandbox:** everything else. Earth Engine is blocked there, and the archive is mounted read-only.

## Inputs

- **Published traces:** `dist-data/v1/glaciers/GID*/traces.geojson` (gzipped). These supply the dates and sensors to fetch and the trace ids to link.
- **Glacier boxes:** `/home/oxygen/Downloads/autoterm_data/GEE/Glacier_ID_list.txt` is the clean modern ROI for 290 of 295 glaciers. `Glacier Identification.csv` in the archive has `ROI` and `ROI_historical`, both with digits damaged into spaces.
- **Image filters**, from the authors' download scripts in `GEE/`:
  - S1: IW mode, high resolution, HH;
  - S2: B4, cloud below 60%;
  - L8 and L7: B8 (panchromatic, 15 m), cloud below 60%;
  - L5: B3 (30 m), cloud below 60%.
  - Landsat is Collection 2, because Collection 1 is no longer in Earth Engine. S2 is `COPERNICUS/S2_HARMONIZED`.

## Steps

### 1. ROI lists (sandbox)

```bash
cd prep && uv run python write_rois.py --identification "/home/oxygen/Downloads/autoterm_data/Glacier Identification.csv" \
  --clean-list /home/oxygen/Downloads/autoterm_data/GEE/Glacier_ID_list.txt --traces ../dist-data/v1 --out ../dist-data/rois
```

- **`modern.txt`** (for L8, S1, S2): the clean list. For a glacier missing from it, use the repaired `ROI` (spaces read as 0), accepted only if it holds at least 90% of the glacier's traces.
- **`landsat.txt`** (for L5, L7): the bounding box of the modern box and the repaired `ROI_historical`. The early termini lie outside the modern box: against it alone, 27.5% of L5 traces and 17.2% of L7 traces stick out.
- **Fitting the traces:** any box that a trace sticks out of is grown to fit (trace bounds plus 0.01°). After this, every published trace lies inside its box.
- **Other files:** `report.csv` gives the share of each glacier's traces inside its box. `changed_*.txt` list the glaciers whose box differs from the clean list; these mattered only because scenes had already been fetched with the old boxes.

### 2. Download (developer)

```bash
cd tools/gee
D=/home/oxygen/Downloads/autoterm_data R=../../dist-data/rois
.env/bin/python download.py --project autoterm-509520 --out $D/scenes --roi-list $R/modern.txt --sensors S1,S2,L8 \
  --hours 10 --concurrency 16 2>&1 | tee -a $D/scenes/download.log
.env/bin/python download.py --project autoterm-509520 --out $D/scenes --roi-list $R/landsat.txt --sensors L5,L7 \
  --hours 10 --concurrency 16 2>&1 | tee -a $D/scenes/download.log
```

- **What it fetches:** for each glacier, every scene on a traced date and sensor that touches the box. That means all scenes of the date, so a trace day with two scenes gets both. Each is one band as a zipped GeoTIFF, clipped to the box.
- **Stopping and resuming:** rerun the same command. Finished files are skipped, partial files discarded, and failures go to `failures.jsonl` to be retried on the next run.
- **Speed:** about 17,000 scenes an hour at 16 parallel requests.
- **The 48 MB cap per request:** a scene over it is clipped to the bounding box of that day's traces plus `--margin-km` (2 km). If that is still too large, it is fetched at a whole multiple of the native pixel size (S1/S2 10 m, L7/L8 15 m, L5 30 m).

### 3. Coverage check (sandbox)

```bash
cd prep && uv run python coverage_check.py --scenes /home/oxygen/Downloads/autoterm_data/scenes --traces ../dist-data/v1 \
  --out ../dist-data/coverage
```

Writes `missing.csv`: one row per glacier, sensor and day that has a trace but no scene.

### 4. Find the missed scenes (developer)

```bash
cd tools/gee && .env/bin/python listing_misses.py --project autoterm-509520 --missing ../../dist-data/coverage/missing.csv \
  --rois ../../dist-data/rois --out ../../dist-data/coverage/listing_misses.csv
```

For each miss, it lists every scene from the day before to the day after, in all Landsat tiers and with no filters. It then names the cause:

- `listed`: the listing should have found it;
- `cloud filter`;
- `other collection` (Tier 2 or real-time);
- `neighbouring day only`;
- `none`.

Of the 3,554 traces without a scene, 97.6% had a scene in Tier 2 only and 69 had one dropped by the cloud filter. Rows that end in `error` (the per-minute read quota) go back through as a smaller `missing.csv`.

### 5. Fill (developer)

Run the two step 2 commands again, each with `--scenes-from ../../dist-data/coverage/listing_misses.csv` added (repeat the option for each retry file). Keep the same ROI list for each sensor group: the list sets the box each scene is clipped to.

This fetches the same-day scenes that step 4 found (4,064 files). Run step 3 again afterwards to confirm.

### 6. Previews (sandbox)

```bash
cd prep && uv run python build_previews.py --scenes /home/oxygen/Downloads/autoterm_data/scenes --traces ../dist-data/v1 \
  --out ../dist-data/images --workers 8
```

- **Images:** one AVIF per scene (quality 50, half resolution), stretched between the 2nd and 98th percentile, with no-data transparent.
- **`images.json`** (gzipped), one per glacier:

  ```json
  {"glacier": "GID278", "scenes": [{"id": "LT05_008011_19850610", "date": "1985-06-10", "sensor": "L5",
    "image": "GID278/LT05_008011_19850610.avif", "corners": [[-50.119, 69.269], ...], "traces": ["GID278_19850610_L5"]}]}
  ```

  The four corners (top-left, top-right, bottom-right, bottom-left, lon/lat) place the image on the map. Traces are linked by date and sensor.
- **Rerunning:** an image is rebuilt only when its scene zip is newer, and the trace links are always refreshed. The full build took 42 minutes at 8 workers.

### 7. Alignment spot check (sandbox)

```bash
cd prep && uv run python overlay_check.py --scenes /home/oxygen/Downloads/autoterm_data/scenes --traces ../dist-data/v1 \
  --glaciers GID278 --sensors L8,S2 --csv ../dist-data/coverage/overlay.csv
```

- **Method:** slides each trace along its normal (±6 px in half-pixel steps) and reads off the offset where it sits on the strongest edge.
- **Reading it:** use S2 as the control, since the authors drew on the same product. Results are indicative only. The method can't tell misregistration from a hazy image with no clear front, and the traces carry the authors' own error (mean 79 m).
- **Findings:** L8 Collection 2 shows no systematic offset beyond about 10 m, and Landsat 5 Tier 2 is the one weak spot (see Result).

### 8. Upload (developer)

Done 2026-11-04 by hand with rclone, from the repo root. `prep/upload.sh` only handles versioned folders. The previews go to an unversioned `autoterm/images/` prefix beside `v1/`, since the scenes don't change between data versions (layout and headers: `implementation-plan.md` §4).

Previews first, so no index ever points at a missing image. The options are written out in full so the commands also work in fish:

```bash
rclone copy dist-data/images r2:BUCKET/autoterm/images \
  --include '*.avif' --exclude '*.part' --s3-no-check-bucket --transfers 32 --checkers 32 \
  --header-upload "Content-Type: image/avif" \
  --header-upload "Cache-Control: public, max-age=604800" \
  --progress --log-file previews-upload.log --log-level INFO

rclone copy dist-data/images r2:BUCKET/autoterm/images \
  --include 'images.json' --exclude '*.part' --s3-no-check-bucket --transfers 32 --checkers 32 \
  --header-upload "Content-Type: application/json" \
  --header-upload "Content-Encoding: gzip" \
  --header-upload "Cache-Control: public, max-age=300"

rclone check dist-data/images r2:BUCKET/autoterm/images --one-way --exclude '*.part' --s3-no-check-bucket
```

- **Dry runs:** 352,062 previews (6.092 GiB) and 295 indexes (7.170 MiB), matching the build.
- **Log and check:** the upload log has no errors, and the full `rclone check` found no differences.
- **From the sandbox:**
  - the index is `application/json`, gzipped, `max-age=300`; the preview is `image/avif`, `max-age=604800`;
  - an `Origin: https://autotermlab.github.io` request gets `Access-Control-Allow-Origin` back;
  - a sample of 52 files (12 indexes, 40 previews) is byte-identical to `dist-data/images/`.
- **Headers can't be fixed by rerunning:** rclone skips unchanged files, so it won't rewrite their headers. A wrong header means uploading those files again (e.g. with `--ignore-times`).
- **After rebuilding the indexes** (e.g. to add the tier), rerun only the `images.json` pass, then the check.

### Still to do

- Record each scene's tier and the data version in `images.json`, then re-upload the 295 indexes (step 8, second pass).
- Decide whether `prep/upload.sh` gets an `--images` mode. It's only needed for re-uploading the indexes.
- **Possible refinement:** link each trace only to the same-day scenes that actually overlap it. Today a third of the traces (71,683) link to more than one scene, up to 36.

## Pitfalls met (and how they were handled)

- **Damaged ROI digits.** Reading a space as 0 reproduces the clean list for 283 of 290 glaciers, but not always (GID52 `"-63. "` is -63.18). The clean list also has swapped corners for GID53 and GID86. Never trust a repaired box without checking it against the traces.
- **Traces outside both boxes** (GID104, 150, 171, 181, 234 modern; GID39 Landsat). The authors' ROI must have differed from both boxes, hence the grow-to-fit rule.
- **Tier 2.** A Tier 1-only listing missed the scenes of 3,467 traces. A scene can also sit in both T1 and T1_RT under one file name; fetch it once, or the two copies collide on the same `.part` file.
- **Request too large.** GID85 (2,068 scenes, 49–458 MB per request) and GID105 (4). Even clipped, one GID85 S2 scene failed Earth Engine's 32,768-pixel grid limit; that day has another scene.
- **"503" inside "50331648".** The size error's byte count contains "503", which a substring check took for a busy server and retried for about 62 s each time. Match `\b503\b`.
- **Per-minute read quota.** "Quota exceeded … per minute" is transient: retry with backoff.
- **Skipping by scene id.** One scene can cover two glaciers. An early version skipped a too-large scene for every glacier, which lost GID104's S1 scene of 2021-01-22.
- **Neighbouring days.** Adjacent Landsat paths overlap, so a scene one day off is common (9.2% of L8 traces). Never link a trace to an image it was not drawn on.
- **Reading the GeoTIFFs.** Pillow returns Earth Engine's big-endian float TIFFs byte-swapped. S1 marks no data with ±3.4e38. A box that barely touches a scene gives a sliver under 2 px, which is skipped.
- **Logging.** One download run wrote no log, so its completeness had to be checked separately. Always `tee -a` into `download.log`.
- **"Collection 1" samples.** The `GEE/GID278_Landsat-8` files labelled Collection 1 are pixel-identical to Collection 2, so they can't be used to compare collections.
