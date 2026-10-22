"""Terminus traces from the AutoTerm shapefiles, grouped by the glacier each trace is labeled for.

Five source files hold traces labeled for a different glacier than their file name (plan §3), and
some of those traces also appear in the other glacier's file. The per-trace `Glacier ID` is the
reliable label, so traces are collected by label across files and identical ones are merged.
"""

import logging
from pathlib import Path

import pyogrio.raw
import shapely

log = logging.getLogger(__name__)

SENSOR_CODES = {"Landsat5": "L5", "Landsat7": "L7", "Landsat8": "L8", "Sentinel1": "S1", "Sentinel2": "S2"}
SEASONS = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM", 6: "JJA", 7: "JJA", 8: "JJA",
           9: "SON", 10: "SON", 11: "SON"}


def season(date):
    return SEASONS[int(date[5:7])]


def _read(path, geometry=True):
    meta, _, wkb, fields = pyogrio.raw.read(path, read_geometry=geometry)
    dates, labels, sensors, uncertainties = ([v.strip() for v in column] for column in fields)
    return dates, labels, sensors, uncertainties, wkb


def label_index(paths):
    """{path: labels found in that file}, reading attributes only (cheap)."""
    return {path: set(_read(path, geometry=False)[1]) for path in paths}


def glacier_traces(glacier, index):
    """All traces labeled `glacier` across the files that contain them, with ids, sorted by date."""
    seen, traces = set(), []
    # Own file first, then the rest by name, so ids don't depend on the order of `index`.
    paths = sorted((p for p, labels in index.items() if glacier in labels), key=lambda p: (Path(p).stem != glacier, Path(p).name))
    for path in paths:
        kept = len(traces)
        dates, trace_labels, sensors, uncertainties, wkb = _read(path)
        for date, label, sensor, uncertainty, geometry in zip(dates, trace_labels, sensors, uncertainties, wkb):
            key = (date, sensor, geometry)
            if label != glacier or key in seen:
                continue
            seen.add(key)
            traces.append({
                "date": date,
                "sensor": SENSOR_CODES[sensor],
                "season": season(date),
                "uncertainty_m": None if uncertainty == "N/A" else float(uncertainty),
                "geometry": shapely.from_wkb(geometry),
            })
        merged = sum(1 for label in trace_labels if label == glacier) - (len(traces) - kept)
        if merged or Path(path).stem != glacier:
            log.info("%s: %d kept from %s, %d merged", glacier, len(traces) - kept, Path(path).name, merged)
    traces.sort(key=lambda t: (t["date"], t["sensor"]))
    used = {}
    for t in traces:
        base = f"{glacier}_{t['date'].replace('-', '')}_{t['sensor']}"
        used[base] = used.get(base, 0) + 1
        t["id"] = base if used[base] == 1 else f"{base}_{used[base]}"
    return traces
