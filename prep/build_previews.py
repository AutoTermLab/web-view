"""Build the scene previews for upload to R2 (served from the unversioned `images/` prefix).

    uv run python build_previews.py --scenes /home/oxygen/Downloads/autoterm_data/scenes --traces ../dist-data/v1 --out ../dist-data/images
    uv run python build_previews.py ... --glaciers GID1,GID278 --workers 4

Rerunning skips the images already written, unless their scene zip is newer. `--traces` is a built data version (it supplies the trace ids).
"""

import argparse
import logging
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from autoterm.previews import build_previews, trace_index


def build_one(args):
    glacier, scenes, traces, out = args
    build_previews(glacier, scenes / glacier, trace_index(traces / "glaciers" / glacier / "traces.geojson"), out)
    return glacier


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenes", type=Path, required=True)
    parser.add_argument("--traces", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--glaciers", help="comma-separated ids; default all that have scenes")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    names = args.glaciers.split(",") if args.glaciers else sorted(p.name for p in args.scenes.glob("GID*"))
    jobs = [(g, args.scenes, args.traces, args.out) for g in names]
    with ProcessPoolExecutor(args.workers) as pool:
        for done, glacier in enumerate(pool.map(build_one, jobs), 1):
            logging.info("%s (%d/%d)", glacier, done, len(jobs))


if __name__ == "__main__":
    main()
