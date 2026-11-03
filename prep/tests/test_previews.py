import gzip
import io
import json
import zipfile

import numpy as np
from PIL import Image, TiffImagePlugin

import struct
import zlib

from autoterm.previews import build_previews, corners, pixel_array, read_scene, scene_date, to_preview


def geotiff(array, origin=(500000.0, 7900000.0), res=10.0, epsg=32622):
    """The bytes of a GeoTIFF laid out like an Earth Engine export (big-endian, deflate, ModelTransformation + EPSG key)."""
    ifd = TiffImagePlugin.ImageFileDirectory_v2(prefix=b"MM")
    ifd.tagtype[34264] = 12
    ifd[34264] = (res, 0.0, 0.0, origin[0], 0.0, -res, 0.0, origin[1], 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    ifd.tagtype[34735] = 3
    ifd[34735] = (1, 1, 2, 1, 3072, 0, 1, epsg)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, "TIFF", tiffinfo=ifd, compression="tiff_adobe_deflate")
    return buffer.getvalue()


def write_scene(folder, name, array, **kwargs):
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(folder / f"{name}.zip", "w") as z:
        z.writestr(f"{name}.B8.tif", geotiff(array, **kwargs))


def test_scene_date_per_sensor():
    assert scene_date("S1", "S1A_IW_GRDH_1SDH_20170124T095928_20170124T095953_014972_01870F_2AF2") == "2017-01-24"
    assert scene_date("S2", "20150710T153226_20150710T153237_T21WXV") == "2015-07-10"
    assert scene_date("L8", "LC08_011009_20140701") == "2014-07-01"


def test_read_scene_returns_pixels_transform_and_epsg(tmp_path):
    pixels = np.arange(12, dtype="uint16").reshape(3, 4)
    write_scene(tmp_path, "LC08_011009_20140701", pixels, origin=(500000.0, 7900000.0), res=15.0)
    array, transform, epsg = read_scene(tmp_path / "LC08_011009_20140701.zip")
    assert array.shape == (3, 4) and array[2, 3] == 11
    assert transform == (15.0, 500000.0, -15.0, 7900000.0)  # pixel width, west, pixel height, north
    assert epsg == 32622


def big_endian_float_tiff(array):
    """A minimal deflate-compressed big-endian float32 TIFF, like Earth Engine's (Pillow only writes little-endian)."""
    rows, cols = array.shape
    data = zlib.compress(array.astype(">f4").tobytes())
    tags = [(256, 4, cols), (257, 4, rows), (258, 3, 32), (259, 3, 8), (262, 3, 1), (273, 4, 8), (277, 3, 1),
            (278, 4, rows), (279, 4, len(data)), (339, 3, 3)]
    ifd = struct.pack(">H", len(tags)) + b"".join(
        struct.pack(">HHI", tag, kind, 1) + (struct.pack(">H2x", v) if kind == 3 else struct.pack(">I", v)) for tag, kind, v in tags
    ) + struct.pack(">I", 0)
    return b"MM\x00*" + struct.pack(">I", 8 + len(data)) + data + ifd


def test_pixel_array_reads_big_endian_float_tiffs_correctly():
    pixels = np.random.default_rng(2).normal(-15, 5, (6, 8)).astype("float32")  # Sentinel-1 dB, as Earth Engine exports them
    image = Image.open(io.BytesIO(big_endian_float_tiff(pixels)))
    assert np.allclose(pixel_array(image), pixels)


def test_corners_are_top_left_top_right_bottom_right_bottom_left_in_lon_lat():
    result = corners((10.0, 500000.0, -10.0, 7900000.0), (100, 200), 32622)
    top_left, top_right, bottom_right, bottom_left = result
    assert top_left[0] < top_right[0] and top_left[1] > bottom_left[1]
    assert all(len(c) == 2 and -180 < c[0] < 180 and 60 < c[1] < 85 for c in result)
    assert result[0] == [round(v, 5) for v in result[0]]


def test_to_preview_halves_size_stretches_and_masks_no_data():
    pixels = np.linspace(1000, 9000, 40 * 60, dtype="float32").reshape(40, 60)
    pixels[:, :4] = 0  # no data (Landsat and Sentinel-2 use 0)
    image = to_preview(pixels)
    assert image.size == (30, 20) and image.mode == "LA"
    gray, alpha = np.array(image)[..., 0], np.array(image)[..., 1]
    assert alpha[:, 0].max() == 0 and alpha[:, 5:].min() == 255
    assert gray[alpha == 255].min() < 20 and gray[alpha == 255].max() > 235


def test_to_preview_treats_non_finite_and_huge_values_as_no_data():
    pixels = np.random.default_rng(0).normal(-15, 3, (20, 20)).astype("float32")
    pixels[:2, :2] = [[np.nan, 3.4e38], [-3.4e38, np.inf]]  # Sentinel-1 exports
    alpha = np.array(to_preview(pixels))[..., 1]
    assert alpha[0, 0] == 0 and alpha[1:, 1:].min() == 255


def test_build_previews_writes_images_and_index_linked_to_traces(tmp_path):
    scenes, out = tmp_path / "scenes", tmp_path / "out"
    pixels = (np.random.default_rng(1).random((40, 60)) * 9000 + 1000).astype("uint16")
    write_scene(scenes / "GID7" / "L8", "LC08_011009_20140701", pixels, res=15.0)
    write_scene(scenes / "GID7" / "L8", "LC08_012009_20140701", pixels, res=15.0)  # second scene, same date
    write_scene(scenes / "GID7" / "L8", "LC08_011009_20140717", pixels, res=15.0)  # no trace that day
    traces = {("2014-07-01", "L8"): ["GID7_20140701_L8", "GID7_20140701_L8_2"]}

    build_previews("GID7", scenes / "GID7", traces, out)

    index = json.loads(gzip.decompress((out / "GID7" / "images.json").read_bytes()))
    assert index["glacier"] == "GID7"
    by_id = {s["id"]: s for s in index["scenes"]}
    assert set(by_id) == {"LC08_011009_20140701", "LC08_012009_20140701", "LC08_011009_20140717"}
    first = by_id["LC08_011009_20140701"]
    assert first["date"] == "2014-07-01" and first["sensor"] == "L8"
    assert first["image"] == "GID7/LC08_011009_20140701.avif"
    assert first["traces"] == ["GID7_20140701_L8", "GID7_20140701_L8_2"]
    assert len(first["corners"]) == 4
    assert by_id["LC08_011009_20140717"]["traces"] == []
    image = Image.open(out / first["image"])
    assert image.format == "AVIF" and image.size == (30, 20)


def test_build_previews_skips_scenes_already_written(tmp_path):
    scenes, out = tmp_path / "scenes", tmp_path / "out"
    pixels = (np.random.default_rng(1).random((40, 60)) * 9000 + 1000).astype("uint16")
    write_scene(scenes / "GID7" / "L8", "LC08_011009_20140701", pixels)
    build_previews("GID7", scenes / "GID7", {}, out)
    target = out / "GID7" / "LC08_011009_20140701.avif"
    before = target.stat().st_mtime_ns
    build_previews("GID7", scenes / "GID7", {}, out)
    assert target.stat().st_mtime_ns == before


def test_trace_index_groups_trace_ids_by_date_and_sensor(tmp_path):
    from autoterm.previews import trace_index

    features = [{"properties": {"trace_id": i, "date": d, "sensor": s}} for i, d, s in [
        ("GID7_20140701_L8", "2014-07-01", "L8"), ("GID7_20140701_L8_2", "2014-07-01", "L8"), ("GID7_20140701_S2", "2014-07-01", "S2")]]
    path = tmp_path / "traces.geojson"
    path.write_bytes(gzip.compress(json.dumps({"features": features}).encode()))
    assert trace_index(path) == {("2014-07-01", "L8"): ["GID7_20140701_L8", "GID7_20140701_L8_2"], ("2014-07-01", "S2"): ["GID7_20140701_S2"]}


def test_build_previews_skips_slivers_too_small_to_halve(tmp_path):
    scenes, out = tmp_path / "scenes", tmp_path / "out"
    pixels = (np.random.default_rng(1).random((40, 60)) * 9000 + 1000).astype("uint16")
    write_scene(scenes / "GID7" / "L5", "LT05_230013_19890827", pixels[:1, :3])  # the ROI barely touches the scene
    write_scene(scenes / "GID7" / "L5", "LT05_230013_19890912", pixels)
    build_previews("GID7", scenes / "GID7", {}, out)
    index = json.loads(gzip.decompress((out / "GID7" / "images.json").read_bytes()))
    assert [s["id"] for s in index["scenes"]] == ["LT05_230013_19890912"]
    assert not (out / "GID7" / "LT05_230013_19890827.avif").exists()


def test_build_previews_rebuilds_images_older_than_their_scene(tmp_path):  # scenes fetched again with a new box
    import os

    scenes, out = tmp_path / "scenes", tmp_path / "out"
    pixels = (np.random.default_rng(1).random((40, 60)) * 9000 + 1000).astype("uint16")
    write_scene(scenes / "GID7" / "L5", "LT05_230013_19890912", pixels)
    build_previews("GID7", scenes / "GID7", {}, out)
    target = out / "GID7" / "LT05_230013_19890912.avif"
    os.utime(target, ns=(1, 1))
    build_previews("GID7", scenes / "GID7", {}, out)
    assert target.stat().st_mtime_ns > 1


def test_build_previews_leaves_no_partial_image_when_interrupted(tmp_path, monkeypatch):
    import pytest

    import autoterm.previews

    class Interrupted:
        def save(self, path, **kwargs):
            open(path, "wb").write(b"half an image")
            raise KeyboardInterrupt

    scenes, out = tmp_path / "scenes", tmp_path / "out"
    write_scene(scenes / "GID7" / "L5", "LT05_230013_19890912", np.ones((40, 60), dtype="uint16"))
    monkeypatch.setattr(autoterm.previews, "to_preview", lambda pixels: Interrupted())
    with pytest.raises(KeyboardInterrupt):
        build_previews("GID7", scenes / "GID7", {}, out)
    assert not (out / "GID7" / "LT05_230013_19890912.avif").exists()


def test_build_previews_reuses_the_index_for_images_up_to_date(tmp_path, monkeypatch):
    import autoterm.previews

    scenes, out = tmp_path / "scenes", tmp_path / "out"
    pixels = (np.random.default_rng(1).random((40, 60)) * 9000 + 1000).astype("uint16")
    write_scene(scenes / "GID7" / "L8", "LC08_011009_20140701", pixels)
    build_previews("GID7", scenes / "GID7", {}, out)
    first = json.loads(gzip.decompress((out / "GID7" / "images.json").read_bytes()))

    def not_again(path):
        raise AssertionError(f"decoded {path} again")

    monkeypatch.setattr(autoterm.previews, "read_scene", not_again)
    build_previews("GID7", scenes / "GID7", {("2014-07-01", "L8"): ["GID7_20140701_L8"]}, out)
    second = json.loads(gzip.decompress((out / "GID7" / "images.json").read_bytes()))
    assert second["scenes"][0]["corners"] == first["scenes"][0]["corners"]
    assert second["scenes"][0]["traces"] == ["GID7_20140701_L8"]  # trace links are always refreshed
