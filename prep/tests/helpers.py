import numpy as np
import pyogrio.raw
import shapely
from shapely.geometry import LineString


def line(x):
    return LineString([(x, 70.0, 0.0), (x + 0.01, 70.01, 0.0)])


def write_shp(path, rows):
    """rows: (date, glacier, satellite, uncertainty, geometry)"""
    columns = list(zip(*rows))
    pyogrio.raw.write(
        path,
        geometry=shapely.to_wkb(np.array(columns[4], dtype=object)),
        field_data=[np.array(c, dtype=object) for c in columns[:4]],
        fields=["Date", "Glacier ID", "Satellite", "Uncertaint"],
        geometry_type="LineString Z",
        crs="EPSG:4326",
        driver="ESRI Shapefile",
    )
