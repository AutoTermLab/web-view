"""Per-glacier terminus change time series, from the provided `GID{n}_all_S1_corrected.csv` files."""

import csv


def read_timeseries(path, glacier):
    """Column-oriented series, or None when the file has no rows."""
    with open(path, newline="") as f:
        reader = csv.reader(f)
        header, rows = next(reader), list(reader)
    if not rows:
        return None
    area, length, t, date = zip(*sorted(rows, key=lambda r: float(r[2])))  # the files are not in date order
    return {
        "glacier": glacier,
        "date": list(date),
        "t": [float(v) for v in t],
        "length_change_m": [float(v) for v in length],
        "area_change_raw": [float(v) for v in area],
        "area_unit_raw": header[0].split("(")[1].rstrip(")"),
    }


def write_timeseries_csv(path, series):
    """The same four columns as the source file, but in date order."""
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([f"Change in area ({series['area_unit_raw']})", "Change in length (m)", "Decimal Date", "YYYY-MM-DD"])
        writer.writerows(zip(series["area_change_raw"], series["length_change_m"], series["t"], series["date"]))
