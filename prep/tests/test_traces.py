from helpers import line, write_shp

from autoterm.traces import glacier_traces, label_index, season


def build(tmp_path):
    """GID101.shp also holds GID102's modern traces; GID102.shp has them plus one more."""
    a, b = tmp_path / "GID101.shp", tmp_path / "GID102.shp"
    write_shp(a, [
        ("2001-07-01", "GID101", "Landsat5", "10.5", line(1)),
        ("2017-02-09", "GID102", "Sentinel1", "24.6", line(2)),
        ("2018-03-04", "GID102", "Landsat8", "N/A", line(3)),
    ])
    write_shp(b, [
        ("2017-02-09", "GID102", "Sentinel1", "24.6", line(2)),
        ("2018-03-04", "GID102", "Landsat8", "N/A", line(3)),
        ("2019-05-05", "GID102", "Sentinel2", "12.0", line(4)),
    ])
    return label_index([a, b])


def test_label_index_lists_labels_per_file(tmp_path):
    index = build(tmp_path)
    assert sorted(index.values(), key=len) == [{"GID102"}, {"GID101", "GID102"}]


def test_traces_follow_their_label_not_their_file(tmp_path):
    index = build(tmp_path)
    own = glacier_traces("GID101", index)
    assert [t["date"] for t in own] == ["2001-07-01"]
    modern = glacier_traces("GID102", index)
    assert [t["date"] for t in modern] == ["2017-02-09", "2018-03-04", "2019-05-05"]  # duplicates merged


def test_traces_are_normalized(tmp_path):
    t = glacier_traces("GID102", build(tmp_path))
    assert t[0]["id"] == "GID102_20170209_S1"
    assert (t[0]["sensor"], t[0]["season"], t[0]["uncertainty_m"]) == ("S1", "DJF", 24.6)
    assert t[1]["uncertainty_m"] is None
    assert t[2]["sensor"] == "S2"


def test_same_day_passes_with_different_geometry_are_kept(tmp_path):
    p = tmp_path / "GID1.shp"
    write_shp(p, [
        ("2017-02-19", "GID1", "Sentinel1", "20", line(1)),
        ("2017-02-19", "GID1", "Sentinel1", "20", line(2)),
    ])
    assert [t["id"] for t in glacier_traces("GID1", label_index([p]))] == [
        "GID1_20170219_S1",
        "GID1_20170219_S1_2",
    ]


def test_season_is_meteorological():
    assert [season(m) for m in ("2000-12-01", "2000-01-31", "2000-04-10", "2000-07-01", "2000-10-15")] == [
        "DJF", "DJF", "MAM", "JJA", "SON",
    ]


def test_ids_do_not_depend_on_path_order(tmp_path):
    a, b = tmp_path / "GID1.shp", tmp_path / "GID2.shp"
    write_shp(a, [("2017-02-19", "GID1", "Sentinel1", "20", line(1))])
    write_shp(b, [("2017-02-19", "GID1", "Sentinel1", "20", line(2))])
    index = label_index([a, b])
    forward = {t["id"]: t["geometry"].wkb for t in glacier_traces("GID1", index)}
    backward = {t["id"]: t["geometry"].wkb for t in glacier_traces("GID1", dict(reversed(index.items())))}
    assert forward == backward
    assert forward["GID1_20170219_S1"] == line(1).wkb  # the glacier's own file comes first


def test_merged_and_foreign_traces_are_logged(tmp_path, caplog):
    own = tmp_path / "GID5.shp"
    write_shp(own, [
        ("2017-02-19", "GID5", "Sentinel1", "20", line(1)),
        ("2017-02-19", "GID5", "Sentinel1", "20", line(1)),  # exact duplicate inside one file
    ])
    other = tmp_path / "GID6.shp"
    write_shp(other, [("2018-01-01", "GID5", "Landsat8", "9", line(2))])
    with caplog.at_level("INFO"):
        glacier_traces("GID5", label_index([own, other]))
    assert "GID5: 1 kept from GID5.shp, 1 merged" in caplog.text
    assert "GID5: 1 kept from GID6.shp, 0 merged" in caplog.text
