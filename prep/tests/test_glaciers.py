from autoterm.glaciers import read_glaciers

IDENTIFICATION = (
    b"Latitude,Longitude,Official_n,ID,Moon ID,ROI,ROI_historical,Bj\xbfrkID,New_Greenl,Old_Greenl,Foreign_na\r\n"
    b'71.76,-51.55,Kangilliup Sermia,1,17,"[-51.76,71.7 8,-51.52,71.777]","[-51.76,71.7 8,-51.52,71.777]",GGN0347,Kangilliup Sermia,Kangigdliup Sermia,Rink Isbr\xc3\xa6\r\n'
    b'72.77,-54.15,,4,20,"[-54.3 ,72.763,-54.13,72.81]","[-54.4,72.763,-54.13,72.82]",,,,\r\n'
    b"72.00,-54.00,Kjer Gletsjer,28,42,\"[-57.9,75.1,-57.4,75.2]\",\"[-57.9,75.1,-57.4,75.2]\",GGN0540, , ,Kjer Gletsjer\r\n"
)
UNCERTAINTY = (
    "﻿Name,Y,X,L5,L7,L8,S1,S2,Duplicate\n"
    "1,71.76,-51.55,20.5,15.7,23.5,23.8,12.8,25.4\n"
    "4,72.77,-54.15,22.3,34.1,17.0,49.1,19.5,46.5\n"
    "28,75.14,-57.66,1.0,#N/A,3.0,4.0,5.0,6.0\n"
    ",,,,,,,,\n,,,,,,,,\n"
)


def write(tmp_path):
    ident, unc = tmp_path / "ident.csv", tmp_path / "unc.csv"
    ident.write_bytes(IDENTIFICATION)
    unc.write_text(UNCERTAINTY, encoding="utf-8")
    return ident, unc


def test_reads_names_ids_and_location(tmp_path):
    glaciers = read_glaciers(*write(tmp_path))
    g = glaciers["GID1"]
    assert g["num"] == 1
    assert g["name"] == "Kangilliup Sermia"
    assert g["names"]["foreign"] == "Rink Isbræ"
    assert g["moon_id"] == 17
    assert g["bjork_id"] == "GGN0347"
    assert (g["lat"], g["lon"]) == (71.76, -51.55)


def test_blank_fields_become_none(tmp_path):
    g = read_glaciers(*write(tmp_path))["GID4"]
    assert g["name"] is None
    assert g["bjork_id"] is None
    assert g["names"]["new_greenlandic"] is None
    assert read_glaciers(*write(tmp_path))["GID28"]["names"]["old_greenlandic"] is None


def test_joins_uncertainty_ignoring_blank_rows(tmp_path):
    glaciers = read_glaciers(*write(tmp_path))
    assert len(glaciers) == 3
    assert glaciers["GID1"]["uncertainty_m"] == {
        "L5": 20.5, "L7": 15.7, "L8": 23.5, "S1": 23.8, "S2": 12.8, "duplicate": 25.4,
    }


def test_roi_is_null_but_raw_string_is_kept(tmp_path):
    g = read_glaciers(*write(tmp_path))["GID1"]
    assert g["roi"] is None
    assert g["roi_raw"] == "[-51.76,71.7 8,-51.52,71.777]"


def test_missing_uncertainty_is_none(tmp_path):
    unc = read_glaciers(*write(tmp_path))["GID28"]["uncertainty_m"]
    assert unc["L7"] is None
    assert unc["L5"] == 1.0
