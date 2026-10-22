"""Build the AutoTerm data files for upload to R2 (see docs/implementation-plan.md §6).

    uv run python build.py --src ~/Downloads/autoterm_data --out ../dist-data/v1 --version v1
    uv run python build.py --src ... --out /tmp/out --version v1 --glaciers GID1,GID2,GID100

`--out` must be empty or missing: a version is written once and never changed.
"""

import argparse
import gzip
import json
import logging
import subprocess
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import pyogrio

from autoterm.glaciers import read_glaciers
from autoterm.manifest import write_manifest
from autoterm.output import TOLERANCE_M, write_json
from autoterm.pipeline import build_glacier
from autoterm.traces import label_index

EXPECTED_GLACIERS = 295
YEARS = (1984, 2022)
MAX_DISPLAY_BYTES = 5_000_000


def extract(archive, suffixes, dest):
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if not info.filename.startswith("__MACOSX") and info.filename.endswith(suffixes):
                info.filename = Path(info.filename).name
                z.extract(info, dest)


def fail(message):
    raise SystemExit(f"invariant failed: {message}")


def validate(entries, out, expected_count):
    if expected_count is not None and len(entries) != expected_count:
        fail(f"expected {expected_count} glaciers, built {len(entries)}")
    for e in entries:
        first, last = (int(d[:4]) for d in e["date_range"])
        if not (YEARS[0] <= first and last <= YEARS[1]):
            fail(f"{e['id']}: date range {e['date_range']} outside {YEARS}")
        display = out / e["files"]["traces"]
        if display.stat().st_size >= MAX_DISPLAY_BYTES:
            fail(f"{e['id']}: display file is {display.stat().st_size} bytes")
        shown = len(json.loads(gzip.decompress(display.read_bytes()))["features"])
        stored = pyogrio.read_info(out / e["files"]["download_traces"], layer="traces")["features"]
        if not shown == stored == e["counts"]["total"]:
            fail(f"{e['id']}: {shown} display, {stored} full-resolution and {e['counts']['total']} counted traces")


def git_version():
    result = subprocess.run(
        ["git", "describe", "--always", "--dirty"], capture_output=True, text=True, cwd=Path(__file__).parent
    )
    return result.stdout.strip()


def build(src, out, version, subset=None, expected_count=None):
    glaciers = read_glaciers(src / "Glacier Identification.csv", src / "uncertainty_all.csv")
    wanted = subset or sorted(glaciers, key=lambda g: glaciers[g]["num"])
    if unknown := sorted(set(wanted) - glaciers.keys()):
        raise SystemExit(f"unknown glaciers: {', '.join(unknown)}")
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; versions are written once")
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        termini, series = Path(tmp) / "termini", Path(tmp) / "series"
        extract(src / "Termini.zip", (".shp", ".shx", ".dbf", ".prj"), termini)
        extract(src / "time_series_terminus_variation_new.zip", (".csv",), series)
        index = label_index(sorted(termini.glob("GID*.shp")))

        entries = []
        for gid in wanted:
            csv = series / f"{gid}_all_S1_corrected.csv"
            entries.append({**glaciers[gid], **build_glacier(gid, index, csv if csv.exists() else None, out)})
            print(f"{gid}: {entries[-1]['counts']['total']} traces")

    validate(entries, out, expected_count)
    write_json(out / "glaciers.json", {
        "schema": 1, "version": version, "generated": date.today().isoformat(), "glaciers": entries,
    })
    write_manifest(
        out, version, sorted(src.glob("*.zip")) + sorted(src.glob("*.csv")),
        {"git_commit": git_version(), "simplify_tolerance_m": TOLERANCE_M, "season_scheme": "meteorological"},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, required=True, help="folder with the raw AutoTerm zips and CSVs")
    parser.add_argument("--out", type=Path, required=True, help="output folder, one per version")
    parser.add_argument("--version", required=True)
    parser.add_argument("--glaciers", help="comma-separated subset, e.g. GID1,GID2")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pyogrio").setLevel(logging.WARNING)
    subset = args.glaciers.split(",") if args.glaciers else None
    build(args.src, args.out, args.version, subset, None if subset else EXPECTED_GLACIERS)


if __name__ == "__main__":
    main()
