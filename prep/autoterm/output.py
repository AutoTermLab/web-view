"""Writers for the per-glacier files: simplified display GeoJSON and full-resolution GeoPackage."""

import calendar
import gzip
import json
from datetime import date

import numpy as np
import pyogrio.raw
import shapely
from pyproj import Transformer

TOLERANCE_M = 5
TO_METRES = Transformer.from_crs(4326, 3413, always_xy=True).transform
TO_DEGREES = Transformer.from_crs(3413, 4326, always_xy=True).transform


def _map(geometry, transform):
    return shapely.transform(geometry, lambda c: np.column_stack(transform(c[:, 0], c[:, 1])))


def _decimal_year(iso_date):
    d = date.fromisoformat(iso_date)
    days = 366 if calendar.isleap(d.year) else 365
    return round(d.year + (d.timetuple().tm_yday - 1) / days, 4)


def display_geojson(traces):
    """Traces simplified to TOLERANCE_M, 2D, lon/lat rounded to 5 decimals (~1 m)."""
    features = []
    for t in traces:
        line = _map(shapely.force_2d(t["geometry"]), TO_METRES).simplify(TOLERANCE_M)
        coordinates = np.round(shapely.get_coordinates(_map(line, TO_DEGREES)), 5).tolist()
        features.append({
            "type": "Feature",
            "id": t["id"],
            "geometry": {"type": "LineString", "coordinates": coordinates},
            "properties": {
                "date": t["date"], "t": _decimal_year(t["date"]), "sensor": t["sensor"], "season": t["season"],
                "uncertainty_m": t["uncertainty_m"], "status": "passed", "reject_reason": None, "image": None,
            },
        })
    return {"type": "FeatureCollection", "features": features}


def write_json(path, obj):
    """Compact JSON, gzipped in place (uploaded with Content-Encoding: gzip)."""
    with open(path, "wb") as f:
        f.write(gzip.compress(json.dumps(obj, separators=(",", ":")).encode(), mtime=0))


def write_gpkg(path, glacier, traces):
    """Original vertices and Z, with the attributes converted to proper types."""
    column = lambda key: np.array([t[key] for t in traces], dtype=object)
    pyogrio.raw.write(
        path,
        layer="traces",
        driver="GPKG",
        geometry=shapely.to_wkb(np.array([t["geometry"] for t in traces], dtype=object)),
        geometry_type="LineString Z",
        crs="EPSG:4326",
        fields=["trace_id", "date", "glacier_id", "sensor", "season", "uncertainty_m", "status"],
        field_data=[
            column("id"),
            np.array([t["date"] for t in traces], dtype="datetime64[D]"),
            np.array([glacier] * len(traces), dtype=object),
            column("sensor"),
            column("season"),
            np.array([np.nan if t["uncertainty_m"] is None else t["uncertainty_m"] for t in traces]),
            np.array(["passed"] * len(traces), dtype=object),
        ],
    )
