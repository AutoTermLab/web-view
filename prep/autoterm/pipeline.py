"""Build one glacier's output files and its entry for `glaciers.json`."""

import shapely

from autoterm.derive import counts, length_trend
from autoterm.output import display_geojson, write_gpkg, write_json
from autoterm.timeseries import read_timeseries, write_timeseries_csv
from autoterm.traces import glacier_traces


def build_glacier(glacier, index, timeseries_csv, out):
    """Write files under `out`/glaciers/<glacier>/ and return the entry fields derived from them."""
    folder = out / "glaciers" / glacier
    (folder / "download").mkdir(parents=True, exist_ok=True)
    rel = lambda path: path.relative_to(out).as_posix()

    traces = glacier_traces(glacier, index)
    write_json(folder / "traces.geojson", display_geojson(traces))
    write_gpkg(folder / "download" / f"{glacier}_traces.gpkg", glacier, traces)
    files = {
        "traces": rel(folder / "traces.geojson"),
        "timeseries": None,
        "download_traces": rel(folder / "download" / f"{glacier}_traces.gpkg"),
        "download_timeseries": None,
    }

    series = read_timeseries(timeseries_csv, glacier) if timeseries_csv else None
    if series:
        write_json(folder / "timeseries.json", series)
        write_timeseries_csv(folder / "download" / f"{glacier}_timeseries.csv", series)
        files["timeseries"] = rel(folder / "timeseries.json")
        files["download_timeseries"] = rel(folder / "download" / f"{glacier}_timeseries.csv")

    dates = [t["date"] for t in traces]
    return {
        "bbox": shapely.total_bounds([t["geometry"] for t in traces]).tolist(),
        "date_range": [min(dates), max(dates)],
        "counts": counts(traces),
        "rejected_count": None,
        "length_trend": length_trend(series),
        "files": files,
    }
