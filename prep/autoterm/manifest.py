"""manifest.json: every published file with its size, hash and the headers it must be uploaded with."""

import hashlib
from datetime import date

from autoterm.output import write_json

CONTENT_TYPES = {
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".csv": "text/csv; charset=utf-8",
    ".gpkg": "application/geopackage+sqlite3",
}
GZIPPED = {".json", ".geojson"}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(out, version, sources, build):
    """`sources`: the raw archive files, hashed so a build can be traced back to its input."""
    files = [
        {
            "path": path.relative_to(out).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "content_type": CONTENT_TYPES[path.suffix],
            "encoding": "gzip" if path.suffix in GZIPPED else None,
        }
        for path in sorted(out.rglob("*"))
        if path.is_file() and path.name != "manifest.json"
    ]
    write_json(out / "manifest.json", {
        "schema": 1,
        "version": version,
        "generated": date.today().isoformat(),
        "source_archive": {p.name: sha256(p) for p in sources},
        "build": build,
        "files": files,
    })
