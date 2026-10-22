import gzip
import hashlib
import json

import pyogrio.raw
from helpers import line, write_shp

from autoterm.manifest import write_manifest
from autoterm.pipeline import build_glacier
from autoterm.traces import label_index

HEADER = "Change in area (10 km2),Change in length (m),Decimal Date,YYYY-MM-DD\n"


def source(tmp_path):
    shp = tmp_path / "GID1.shp"
    write_shp(shp, [
        ("2017-02-09", "GID1", "Sentinel1", "24.6", line(1)),
        ("2018-03-04", "GID1", "Landsat8", "N/A", line(2)),
        ("2018-07-04", "GID1", "Sentinel2", "12.0", line(3)),
    ])
    csv = tmp_path / "GID1.csv"
    csv.write_text(HEADER + "0.0,0.0,2013.0,2013-01-01\n0.1,100.0,2014.0,2014-01-01\n0.2,200.0,2015.0,2015-01-01\n")
    return label_index([shp]), csv


def read_json(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def test_build_glacier_writes_files_and_returns_index_fields(tmp_path):
    index, csv = source(tmp_path)
    out = tmp_path / "v1"
    entry = build_glacier("GID1", index, csv, out)

    assert entry["date_range"] == ["2017-02-09", "2018-07-04"]
    assert entry["bbox"][0] == 1.0 and entry["bbox"][2] == 3.01
    assert entry["counts"]["total"] == 3 and entry["counts"]["by_sensor"]["S1"] == 1
    assert round(entry["length_trend"]["slope_m_per_yr"]) == 100
    assert entry["files"] == {
        "traces": "glaciers/GID1/traces.geojson",
        "timeseries": "glaciers/GID1/timeseries.json",
        "download_traces": "glaciers/GID1/download/GID1_traces.gpkg",
        "download_timeseries": "glaciers/GID1/download/GID1_timeseries.csv",
    }
    assert all((out / path).exists() for path in entry["files"].values())
    assert len(read_json(out / entry["files"]["traces"])["features"]) == 3
    assert read_json(out / entry["files"]["timeseries"])["glacier"] == "GID1"
    assert len(pyogrio.raw.read(out / entry["files"]["download_traces"], layer="traces")[2]) == 3
    assert (out / entry["files"]["download_timeseries"]).read_text().splitlines()[0] == HEADER.strip()


def test_build_glacier_without_a_time_series(tmp_path):
    index, _ = source(tmp_path)
    entry = build_glacier("GID1", index, None, tmp_path / "v1")
    assert entry["files"]["timeseries"] is None and entry["files"]["download_timeseries"] is None
    assert entry["length_trend"]["slope_m_per_yr"] is None


def test_manifest_lists_every_file_with_size_and_hash(tmp_path):
    (tmp_path / "glaciers").mkdir()
    (tmp_path / "glaciers.json").write_bytes(gzip.compress(b"{}"))
    (tmp_path / "glaciers" / "a.gpkg").write_bytes(b"abc")
    write_manifest(tmp_path, "v1", sources=[], build={"simplify_tolerance_m": 5})
    manifest = read_json(tmp_path / "manifest.json")
    files = {f["path"]: f for f in manifest["files"]}
    assert set(files) == {"glaciers.json", "glaciers/a.gpkg"}  # the manifest does not list itself
    assert files["glaciers/a.gpkg"] == {
        "path": "glaciers/a.gpkg", "bytes": 3, "sha256": hashlib.sha256(b"abc").hexdigest(),
        "content_type": "application/geopackage+sqlite3", "encoding": None,
    }
    assert files["glaciers.json"]["encoding"] == "gzip"
    assert manifest["version"] == "v1" and manifest["build"] == {"simplify_tolerance_m": 5}
