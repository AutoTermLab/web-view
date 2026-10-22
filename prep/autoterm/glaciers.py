"""Glacier index: names, IDs, location and uncertainty, keyed by glacier ID ("GID1")."""

import csv

SENSORS = ("L5", "L7", "L8", "S1", "S2")


def _text(value):
    value = (value or "").strip()
    return value or None


def _number(value):
    return None if value.strip() == "#N/A" else float(value)


def _rows(path, encoding):
    with open(path, encoding=encoding, errors="replace", newline="") as f:
        return [row for row in csv.reader(f)][1:]  # skip the header, which has a stray byte


def read_glaciers(identification_csv, uncertainty_csv):
    uncertainty = {
        int(r[0]): {**dict(zip(SENSORS, map(_number, r[3:8]))), "duplicate": _number(r[8])}
        for r in _rows(uncertainty_csv, "utf-8-sig")
        if r[0].strip()
    }
    glaciers = {}
    for r in _rows(identification_csv, "utf-8"):
        if not r[3].strip():
            continue
        num = int(r[3])
        official, new, old, foreign = (_text(v) for v in (r[2], r[8], r[9], r[10]))
        glaciers[f"GID{num}"] = {
            "id": f"GID{num}",
            "num": num,
            "name": official or new,
            "names": {
                "official": official,
                "new_greenlandic": new,
                "old_greenlandic": old,
                "foreign": foreign,
            },
            "moon_id": int(r[4]),
            "bjork_id": _text(r[7]),
            "lat": float(r[0]),
            "lon": float(r[1]),
            "roi": None,  # source strings are corrupted; see plan §3
            "roi_raw": _text(r[5]),
            "uncertainty_m": uncertainty[num],
        }
    return glaciers
