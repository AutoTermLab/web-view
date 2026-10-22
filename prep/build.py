"""Build the AutoTerm data files for upload to R2 (see docs/implementation-plan.md §6).

    uv run python build.py --src ~/Downloads/autoterm_data --out ../dist-data/v1 --version v1
    uv run python build.py --src ... --out /tmp/out --glaciers GID1,GID2,GID100
"""

import argparse
import logging
import subprocess
import tempfile
import zipfile
from datetime import date
from pathlib import Path

from autoterm.manifest import write_manifest
from autoterm.glaciers import read_glaciers
from autoterm.output import TOLERANCE_M, write_json
from autoterm.pipeline import build_glacier
from autoterm.traces import label_index

MAX_DISPLAY_BYTES = 5_000_000


def extract(archive, suffixes, dest):
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if not info.filename.startswith("__MACOSX") and info.filename.endswith(suffixes):
                info.filename = Path(info.filename).name
                z.extract(info, dest)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, required=True, help="folder with the raw AutoTerm zips and CSVs")
    parser.add_argument("--out", type=Path, required=True, help="output folder, one per version")
    parser.add_argument("--version", required=True)
    parser.add_argument("--glaciers", help="comma-separated subset, e.g. GID1,GID2")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("pyogrio").setLevel(logging.WARNING)

    glaciers = read_glaciers(args.src / "Glacier Identification.csv", args.src / "uncertainty_all.csv")
    wanted = args.glaciers.split(",") if args.glaciers else sorted(glaciers, key=lambda g: glaciers[g]["num"])
    args.out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        termini, series = Path(tmp) / "termini", Path(tmp) / "series"
        extract(args.src / "Termini.zip", (".shp", ".shx", ".dbf", ".prj"), termini)
        extract(args.src / "time_series_terminus_variation_new.zip", (".csv",), series)
        index = label_index(sorted(termini.glob("GID*.shp")))

        entries = []
        for gid in wanted:
            csv = series / f"{gid}_all_S1_corrected.csv"
            entries.append({**glaciers[gid], **build_glacier(gid, index, csv if csv.exists() else None, args.out)})
            print(f"{gid}: {entries[-1]['counts']['total']} traces")

    for entry in entries:
        assert (args.out / entry["files"]["traces"]).stat().st_size < MAX_DISPLAY_BYTES, f"{entry['id']} display file too large"
    write_json(args.out / "glaciers.json", {
        "schema": 1, "version": args.version, "generated": date.today().isoformat(), "glaciers": entries,
    })
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    write_manifest(
        args.out, args.version, sorted(args.src.glob("*.zip")) + sorted(args.src.glob("*.csv")),
        {"git_commit": commit, "simplify_tolerance_m": TOLERANCE_M, "season_scheme": "meteorological"},
    )


if __name__ == "__main__":
    main()
