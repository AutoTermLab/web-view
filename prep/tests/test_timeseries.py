from autoterm.derive import counts, length_trend
from autoterm.timeseries import read_timeseries

HEADER = "Change in area (10 km2),Change in length (m),Decimal Date,YYYY-MM-DD\n"


def test_reads_columns(tmp_path):
    path = tmp_path / "GID1.csv"
    path.write_text(HEADER + "0.0000,0.0000,2013.2409,2013-03-30\n0.0170,36.7114,2013.2546,2013-04-04\n")
    assert read_timeseries(path, "GID1") == {
        "glacier": "GID1",
        "date": ["2013-03-30", "2013-04-04"],
        "t": [2013.2409, 2013.2546],
        "length_change_m": [0.0, 36.7114],
        "area_change_raw": [0.0, 0.017],
        "area_unit_raw": "10 km2",
    }


def test_header_only_file_has_no_series(tmp_path):
    path = tmp_path / "GID266.csv"
    path.write_text(HEADER)
    assert read_timeseries(path, "GID266") is None


def series(rate):
    t = [2013.0 + i for i in range(5)]
    return {"date": [f"{int(x)}-01-01" for x in t], "t": t, "length_change_m": [rate * i for i in range(5)]}


def test_length_trend_is_the_least_squares_slope():
    r = length_trend(series(-120.0))
    assert round(r["slope_m_per_yr"], 6) == -120.0
    assert (r["period"], r["n"], r["method"]) == (["2013-01-01", "2017-01-01"], 5, "ols_length_change")
    assert "category" not in r  # the sign convention is unconfirmed, so no advance/retreat label


def test_length_trend_is_empty_without_a_series():
    assert length_trend(None) == {"slope_m_per_yr": None, "period": None, "method": "ols_length_change", "n": 0}


def test_counts_by_sensor_season_and_year():
    traces = [
        {"date": "2017-02-09", "sensor": "S1", "season": "DJF"},
        {"date": "2017-07-01", "sensor": "S1", "season": "JJA"},
        {"date": "2018-02-09", "sensor": "L8", "season": "DJF"},
    ]
    assert counts(traces) == {
        "total": 3,
        "by_sensor": {"L5": 0, "L7": 0, "L8": 1, "S1": 2, "S2": 0},
        "by_season": {"DJF": 2, "MAM": 0, "JJA": 1, "SON": 0},
        "by_year_sensor": {"2017": {"S1": 2}, "2018": {"L8": 1}},
    }


def test_rows_are_sorted_by_time(tmp_path):
    path = tmp_path / "GID1.csv"
    path.write_text(HEADER + "0.2,20.0,2015.5,2015-07-01\n0.0,0.0,2013.2,2013-03-30\n0.1,10.0,2014.1,2014-02-01\n")
    s = read_timeseries(path, "GID1")
    assert s["date"] == ["2013-03-30", "2014-02-01", "2015-07-01"]
    assert s["length_change_m"] == [0.0, 10.0, 20.0]
    assert s["area_change_raw"] == [0.0, 0.1, 0.2]
