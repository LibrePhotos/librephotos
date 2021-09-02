import logging
import logging.handlers
import os
import os.path

import exiftool
import numpy as np
import requests
import spacy
from scipy.spatial import distance

import ownphotos.settings

nlp = spacy.load("en_core_web_sm")

logger = logging.getLogger("ownphotos")
fomatter = logging.Formatter(
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s"
)
fileMaxByte = 256 * 1024 * 200  # 100MB
fileHandler = logging.handlers.RotatingFileHandler(
    os.path.join(ownphotos.settings.LOGS_ROOT, "ownphotos.log"),
    maxBytes=fileMaxByte,
    backupCount=10,
)
fileHandler.setFormatter(fomatter)
logger.addHandler(fileHandler)
logger.setLevel(logging.INFO)


def convert_to_degrees(values):
    """
    Helper function to convert the GPS coordinates stored in the EXIF to degress in float format
    :param value:
    :type value: exifread.utils.Ratio
    :rtype: float
    """
    d = float(values[0].num) / float(values[0].den)
    m = float(values[1].num) / float(values[1].den)
    s = float(values[2].num) / float(values[2].den)

    return d + (m / 60.0) + (s / 3600.0)


weekdays = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
}


def compute_bic(kmeans, X):
    """
    Computes the BIC metric for a given clusters

    Parameters:
    -----------------------------------------
    kmeans:  List of clustering object from scikit learn

    X     :  multidimension np array of data points

    Returns:
    -----------------------------------------
    BIC value
    """
    # assign centers and labels
    centers = [kmeans.cluster_centers_]
    labels = kmeans.labels_
    # number of clusters
    m = kmeans.n_clusters
    # size of the clusters
    n = np.bincount(labels)
    # size of data set
    N, d = X.shape

    # compute variance for all clusters beforehand
    cl_var = (1.0 / (N - m) / d) * sum(
        [
            sum(
                distance.cdist(X[np.where(labels == i)], [centers[0][i]], "euclidean")
                ** 2
            )
            for i in range(m)
        ]
    )

    const_term = 0.5 * m * np.log(N) * (d + 1)

    BIC = (
        np.sum(
            [
                n[i] * np.log(n[i])
                - n[i] * np.log(N)
                - ((n[i] * d) / 2) * np.log(2 * np.pi * cl_var)
                - ((n[i] - 1) * d / 2)
                for i in range(m)
            ]
        )
        - const_term
    )

    return BIC


def mapbox_reverse_geocode(lat, lon):
    mapbox_api_key = os.environ.get("MAPBOX_API_KEY", "")

    if mapbox_api_key == "":
        return {}

    url = (
        "https://api.mapbox.com/geocoding/v5/mapbox.places/%f,%f.json?access_token=%s"
        % (lon, lat, mapbox_api_key)
    )
    resp = requests.get(url)
    if resp.status_code == 200:
        resp_json = resp.json()
        search_terms = []
        if "features" in resp_json.keys():
            for feature in resp_json["features"]:
                search_terms.append(feature["text"])

        resp_json["search_text"] = " ".join(search_terms)
        logger.info("mapbox returned status 200.")
        return resp_json
    else:
        # logger.info('mapbox returned non 200 response.')
        logger.warning("mapbox returned status {} response.".format(resp.status_code))
        return {}


def get_existing_sidecar_file(media_file):
    for sidecar_file in get_sidecar_file_alternatives(media_file):
        if os.path.exists(sidecar_file):
            return sidecar_file
    return None


def get_sidecar_file_alternatives(media_file):
    sidecar_file_alternatives = []
    image_basename = os.path.splitext(media_file)[0]
    sidecar_file_alternatives.extend([image_basename + ext for ext in [".xmp", ".XMP"]])
    sidecar_file_alternatives.extend([media_file + ext for ext in [".xmp", ".XMP"]])
    return sidecar_file_alternatives


exiftool_instance = exiftool.ExifTool()


def get_metadata(media_file, tags, try_sidecar=True):
    """
    Get values for each metadata tag in *tags* from *media_file*.
    If *try_sidecar* is `True`, use the value set in any XMP sidecar file
    stored alongside *media_file*.

    If *exiftool_instance* is running, leave it running when returning
    from this function. Otherwise, start it and then terminate it before
    returning.

    Returns a list with the value of each tag in *tags* or `None` if the
    tag was not found.

    """
    et = exiftool_instance
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True
    values = []
    try:
        for tag in tags:
            value = et.get_tag(tag, media_file)
            if try_sidecar:
                sidecar_file = get_existing_sidecar_file(media_file)
                if sidecar_file:
                    value_sidecar = et.get_tag(tag, sidecar_file)
                    if value_sidecar is not None:
                        value = value_sidecar
            values.append(value)
    finally:
        if terminate_et:
            et.terminate()
    return values


def write_metadata(media_file, tags, use_sidecar=True):
    et = exiftool_instance
    terminate_et = False
    if not et.running:
        et.start()
        terminate_et = True

    if use_sidecar:
        file_path = get_sidecar_file_alternatives(media_file)[0]
    else:
        file_path = media_file

    try:
        for tag in tags:
            logger.info(f"Writing {tag} to {file_path}")
            et.execute(("-" + tag).encode("utf-8"), file_path.encode("utf-8"))
    finally:
        if terminate_et:
            et.terminate()
