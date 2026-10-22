import gzip
import json
import zipfile
from pathlib import Path

import pytest
from helpers import line, write_shp

import build as build_module
from build import build

REAL_ARCHIVE = Path("/home/oxygen/Downloads/autoterm_data")

IDENTIFICATION = (
    b"Latitude,Longitude,Official_n,ID,Moon ID,ROI,ROI_historical,Bj\xbfrkID,New_Greenl,Old_Greenl,Foreign_na\r\n"
    b'70.0,1.0,Alpha,1,11,"[0,0,1,1]","[0,0,1,1]",GGN1,,,\r\n'
    b'70.0,2.0,Beta,2,12,"[0,0,1,1]","[0,0,1,1]",GGN2,,,\r\n'
)
UNCERTAINTY = "Name,Y,X,L5,L7,L8,S1,S2,Duplicate\n1,70,1,1,2,3,4,5,6\n2,70,2,1,2,3,4,5,6\n"
SERIES = "Change in area (10 km2),Change in length (m),Decimal Date,YYYY-MM-DD\n0,0,2013.0,2013-01-01\n0.1,100,2014.0,2014-01-01\n"


def make_src(tmp_path, gid2_date="2019-05-05"):
    """A two-glacier archive in the layout of the real one."""
    src, shapes = tmp_path / "src", tmp_path / "shapes"
    src.mkdir(), shapes.mkdir()
    (src / "Glacier Identification.csv").write_bytes(IDENTIFICATION)
    (src / "uncertainty_all.csv").write_text(UNCERTAINTY)
    write_shp(shapes / "GID1.shp", [("2017-02-09", "GID1", "Sentinel1", "24.6", line(1)), ("2018-03-04", "GID1", "Landsat8", "9", line(2))])
    write_shp(shapes / "GID2.shp", [(gid2_date, "GID2", "Sentinel2", "12", line(3))])
    with zipfile.ZipFile(src / "Termini.zip", "w") as z:
        for f in shapes.iterdir():
            z.write(f, f"Termini/{f.name}")
            z.write(f, f"__MACOSX/Termini/._{f.name}")
    with zipfile.ZipFile(src / "time_series_terminus_variation_new.zip", "w") as z:
        z.writestr("time_series_terminus_variation/GID1_all_S1_corrected.csv", SERIES)
    return src


@pytest.fixture
def src(tmp_path):
    return make_src(tmp_path)


def test_builds_every_glacier_and_a_manifest(src, tmp_path):
    out = tmp_path / "v1"
    build(src, out, "v1")
    for name in ("glaciers.json", "manifest.json", "glaciers/GID1/traces.geojson", "glaciers/GID2/download/GID2_traces.gpkg"):
        assert (out / name).exists()
    assert not (out / "glaciers/GID2/timeseries.json").exists()  # GID2 has no series


def test_subset_builds_only_the_named_glaciers(src, tmp_path):
    out = tmp_path / "v1"
    build(src, out, "v1", subset=["GID2"])
    assert (out / "glaciers/GID2").exists() and not (out / "glaciers/GID1").exists()


def test_unknown_glacier_fails_before_extracting(src, tmp_path, monkeypatch):
    monkeypatch.setattr(build_module, "extract", lambda *a: pytest.fail("extracted before checking the glacier ids"))
    with pytest.raises(SystemExit, match="GID99"):
        build(src, tmp_path / "v1", "v1", subset=["GID1", "GID99"])


def test_refuses_a_non_empty_output_folder(src, tmp_path):
    out = tmp_path / "v1"
    out.mkdir()
    (out / "old.txt").write_text("stale")
    with pytest.raises(SystemExit, match="not empty"):
        build(src, out, "v1")
    assert not (out / "glaciers.json").exists()


def test_checks_the_glacier_count(src, tmp_path):
    with pytest.raises(SystemExit, match="expected 3 glaciers"):
        build(src, tmp_path / "v1", "v1", expected_count=3)


@pytest.mark.parametrize("bad_date", ["1950-05-05", "2030-05-05"])
def test_checks_the_date_range(tmp_path, bad_date):
    with pytest.raises(SystemExit, match="date range"):
        build(make_src(tmp_path, gid2_date=bad_date), tmp_path / "v1", "v1")


@pytest.mark.skipif(not REAL_ARCHIVE.exists(), reason="raw AutoTerm archive not available")
def test_real_archive_glacier_1(tmp_path):
    build(REAL_ARCHIVE, tmp_path / "v1", "v1", subset=["GID1"])
    entry = json.loads(gzip.decompress((tmp_path / "v1/glaciers.json").read_bytes()))["glaciers"][0]
    assert entry["id"] == "GID1" and entry["counts"]["total"] == 1296
