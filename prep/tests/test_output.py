import gzip
import json

import numpy as np
import pyogrio.raw
import shapely
from pyproj import Transformer
from shapely.geometry import LineString

from autoterm.output import display_geojson, max_deviation_m, write_gpkg, write_json

TO_METRES = Transformer.from_crs(4326, 3413, always_xy=True).transform


def wiggly_trace():
    """200 points along a near-straight line with sub-metre wiggles, with Z."""
    x = np.linspace(-50.0, -49.9, 200)
    y = 70.0 + 0.0000012 * np.sin(np.arange(200)) + np.linspace(0, 0.05, 200)
    return {
        "id": "GID1_20170209_S1", "date": "2017-02-09", "sensor": "S1", "season": "DJF",
        "uncertainty_m": 24.6, "geometry": LineString(np.column_stack([x, y, np.zeros(200)])),
    }


def test_display_trace_is_simplified_2d_and_rounded():
    trace = wiggly_trace()
    feature = display_geojson([trace])["features"][0]
    coords = feature["geometry"]["coordinates"]
    assert len(coords) < 10
    assert all(len(c) == 2 and c == [round(c[0], 5), round(c[1], 5)] for c in coords)
    simplified = shapely.transform(LineString(coords), lambda c: np.column_stack(TO_METRES(c[:, 0], c[:, 1])))
    original = shapely.transform(trace["geometry"], lambda c: np.column_stack(TO_METRES(c[:, 0], c[:, 1]))[:, :2], include_z=False)
    assert shapely.hausdorff_distance(simplified, shapely.force_2d(original)) < 6  # 5 m tolerance + rounding


def test_display_properties_follow_the_schema():
    feature = display_geojson([wiggly_trace()])["features"][0]
    assert feature["type"] == "Feature" and feature["id"] == "GID1_20170209_S1"
    assert feature["properties"] == {
        "trace_id": "GID1_20170209_S1", "date": "2017-02-09", "t": 2017.1068, "sensor": "S1", "season": "DJF", "uncertainty_m": 24.6,
        "status": "passed", "reject_reason": None, "image": None,
    }


def test_gpkg_keeps_full_resolution_geometry_and_attributes(tmp_path):
    trace = wiggly_trace()
    path = tmp_path / "GID1_traces.gpkg"
    write_gpkg(path, "GID1", [trace])
    meta, _, geometry, fields = pyogrio.raw.read(path, layer="traces")
    assert list(meta["fields"]) == ["trace_id", "date", "glacier_id", "sensor", "season", "uncertainty_m", "status"]
    assert fields[0][0] == "GID1_20170209_S1" and fields[2][0] == "GID1" and fields[6][0] == "passed"
    assert str(fields[1][0]) == "2017-02-09"
    original = shapely.from_wkb(geometry[0])
    assert original.has_z and len(original.coords) == 200 and original.equals_exact(trace["geometry"], 1e-9)


def test_json_is_written_gzipped(tmp_path):
    path = tmp_path / "x.json"
    write_json(path, {"a": [1, None]})
    assert json.loads(gzip.decompress(path.read_bytes())) == {"a": [1, None]}


def test_deviation_is_small_for_a_faithful_simplification_and_large_otherwise():
    trace = wiggly_trace()
    collection = display_geojson([trace])
    assert max_deviation_m([trace], collection) < 6
    shifted = display_geojson([trace])
    shifted["features"][0]["geometry"]["coordinates"] = [[x + 0.01, y] for x, y in shifted["features"][0]["geometry"]["coordinates"]]
    assert max_deviation_m([trace], shifted) > 100
