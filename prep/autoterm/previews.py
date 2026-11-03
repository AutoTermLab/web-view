"""Small preview images of the downloaded satellite scenes (see tools/gee/download.py).

Each scene zip holds one single-band GeoTIFF exported from Earth Engine. A preview is that band stretched to 8 bits,
halved in size and saved as AVIF with the no-data area transparent, plus the four lon/lat corners to place it on a map.
"""

import collections
import gzip
import io
import json
import re
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

from autoterm.output import write_json

SCALE = 2  # preview pixels are SCALE x the source pixels
QUALITY = 50
PERCENTILES = (2, 98)
HUGE = 1e30  # Sentinel-1 exports mark no data with +-3.4e38
MODEL_TRANSFORMATION, GEO_KEYS, PROJECTED_CS = 34264, 34735, 3072


def scene_date(sensor, name):
    """ISO date of a scene from its file name (the same dates the traces use)."""
    if sensor == "S1":
        d = re.search(r"_(\d{8})T", name)[1]
    elif sensor == "S2":
        d = name[:8]
    else:
        d = name.split("_")[-1]
    return f"{d[:4]}-{d[4:6]}-{d[6:]}"


def pixel_array(image):
    """The pixels as float32. Pillow returns big-endian compressed float TIFFs (Earth Engine's) with the bytes swapped."""
    array = np.array(image, dtype="float32")
    return array.byteswap() if image.mode == "F" and image.tag_v2._endian == ">" else array


def read_scene(path):
    """(pixels, (pixel width, west, pixel height, north), EPSG code) of the GeoTIFF inside a scene zip."""
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".tif"))
        image = Image.open(io.BytesIO(z.read(name)))
        image.load()
    t = image.tag_v2[MODEL_TRANSFORMATION]
    keys = image.tag_v2[GEO_KEYS]
    epsg = next(keys[i + 3] for i in range(4, len(keys), 4) if keys[i] == PROJECTED_CS)
    return pixel_array(image), (t[0], t[3], t[5], t[7]), epsg


def corners(transform, shape, epsg):
    """[lon, lat] of the top-left, top-right, bottom-right and bottom-left pixel corners, rounded to ~1 m."""
    width, west, height, north = transform
    rows, cols = shape
    x = [west, west + cols * width, west + cols * width, west]
    y = [north, north, north + rows * height, north + rows * height]
    lon, lat = Transformer.from_crs(epsg, 4326, always_xy=True).transform(x, y)
    return [[round(a, 5), round(b, 5)] for a, b in zip(lon, lat)]


def to_preview(pixels):
    """Grey + alpha image, stretched between the 2nd and 98th percentile, at 1/SCALE of the size."""
    valid = np.isfinite(pixels) & (pixels != 0) & (np.abs(pixels) < HUGE)
    low, high = np.percentile(pixels[valid], PERCENTILES) if valid.any() else (0.0, 1.0)
    grey = np.clip((pixels - low) / max(high - low, 1e-6), 0, 1) * 255
    grey[~valid] = 0
    image = Image.merge("LA", [Image.fromarray(grey.astype("uint8")), Image.fromarray(valid.astype("uint8") * 255)])
    return image.resize((image.width // SCALE, image.height // SCALE), Image.BOX)


def trace_index(path):
    """{(iso date, sensor): [trace ids]} from a glacier's built traces.geojson."""
    index = collections.defaultdict(list)
    for feature in json.loads(gzip.decompress(Path(path).read_bytes()))["features"]:
        p = feature["properties"]
        index[p["date"], p["sensor"]].append(p["trace_id"])
    return dict(index)


def build_previews(glacier, scenes, traces, out):
    """Write <out>/<glacier>/<scene>.avif for every scene zip under `scenes` (<sensor>/<scene>.zip) and images.json.

    `traces` maps (iso date, sensor) to the ids of the traces drawn that day. Images already written are kept unless
    their scene zip is newer (fetched again, e.g. with a wider box); their index entries are reused from images.json.
    """
    folder = Path(out) / glacier
    folder.mkdir(parents=True, exist_ok=True)
    index_path = folder / "images.json"
    previous = {s["id"]: s for s in json.loads(gzip.decompress(index_path.read_bytes()))["scenes"]} if index_path.exists() else {}
    index = []
    for archive in sorted(Path(scenes).glob("*/*.zip")):
        sensor, name = archive.parent.name, archive.stem
        target = folder / f"{name}.avif"
        up_to_date = target.exists() and target.stat().st_mtime >= archive.stat().st_mtime
        date = scene_date(sensor, name)
        if up_to_date and name in previous:
            entry = previous[name]
        else:
            pixels, transform, epsg = read_scene(archive)
            if min(pixels.shape) < SCALE:  # a sliver where the ROI just touches the scene
                continue
            if not up_to_date:
                part = folder / f"{name}.avif.part"  # renamed once complete, so a stopped run leaves no truncated image
                to_preview(pixels).save(part, format="AVIF", quality=QUALITY)
                part.replace(target)
            entry = {"id": name, "date": date, "sensor": sensor, "image": f"{glacier}/{name}.avif",
                     "corners": corners(transform, pixels.shape, epsg)}
        index.append({**entry, "traces": traces.get((date, sensor), [])})
    write_json(index_path, {"glacier": glacier, "scenes": index})
