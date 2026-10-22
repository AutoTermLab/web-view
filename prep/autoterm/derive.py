"""Values derived for the glacier index: length-change trend and trace counts."""

from statistics import linear_regression

from autoterm.glaciers import SENSORS
from autoterm.traces import SEASONS

METHOD = "ols_length_change"


def length_trend(series):
    """Least-squares slope of length change against time, in m/yr, as given in the source data.

    The sign convention is unconfirmed (plan §11), so no advance/retreat label is derived.
    """
    if series is None:
        return {"slope_m_per_yr": None, "period": None, "method": METHOD, "n": 0}
    slope = linear_regression(series["t"], series["length_change_m"]).slope
    return {
        "slope_m_per_yr": slope,
        "period": [series["date"][0], series["date"][-1]],
        "method": METHOD,
        "n": len(series["t"]),
    }


def counts(traces):
    by_year_sensor = {}
    for t in traces:
        year = by_year_sensor.setdefault(t["date"][:4], {})
        year[t["sensor"]] = year.get(t["sensor"], 0) + 1
    return {
        "total": len(traces),
        "by_sensor": {s: sum(t["sensor"] == s for t in traces) for s in SENSORS},
        "by_season": {s: sum(t["season"] == s for t in traces) for s in dict.fromkeys(SEASONS.values())},
        "by_year_sensor": by_year_sensor,
    }
