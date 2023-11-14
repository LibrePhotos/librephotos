import tarfile
from datetime import datetime
from pathlib import Path

import pytz
import requests
from constance import config as site_config
from django.conf import settings

import api.util as util
from api.models.long_running_job import LongRunningJob


class MlTypes:
    CAPTIONING = "captioning"
    FACE_RECOGNITION = "face_recognition"
    CATEGORIES = "categories"
    CLIP = "clip"


ML_MODELS = [
    {
        "id": 1,
        "name": "im2txt",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz",
        "type": MlTypes.CAPTIONING,
        "unpack-command": "tar -zxC",
        "target-dir": "im2txt",
    },
    {
        "id": 2,
        "name": "clip-embeddings",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz",
        "type": MlTypes.CLIP,
        "unpack-command": "tar -zxC",
        "target-dir": "clip-embeddings",
    },
    {
        "id": 3,
        "name": "places365",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz",
        "type": MlTypes.CATEGORIES,
        "unpack-command": "tar -zxC",
        "target-dir": "places365",
    },
    {
        "id": 4,
        "name": "resnet18",
        "url": "https://download.pytorch.org/models/resnet18-5c106cde.pth",
        "type": MlTypes.CATEGORIES,
        "unpack-command": None,
        "target-dir": "resnet18-5c106cde.pth",
    },
    {
        "id": 5,
        "name": "im2txt_onnx",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt_onnx.tar.gz",
        "type": MlTypes.CAPTIONING,
        "unpack-command": "tar -zxC",
        "target-dir": "im2txt_onnx",
    },
]


# To-Dos:
# 1. Add the face recognition model
# 2. Waiting long running jobs looks weird
# 3. The whole dashboard isnt localized yet...
# 4. Create tests for checking if the models are downloaded correctly and downloading them if not
# 5. Upload models to huggingface
# Check if the model is already downloaded and if not download it
def download_model(model):
    model = model.copy()
    if model["type"] == MlTypes.CAPTIONING:
        util.logger.info("Downloading captioning model")
        model_to_download = site_config.CAPTIONING_MODEL
        util.logger.info(f"Model to download: {model_to_download}")
        # Look through ML_MODELS and find the model with the name
        for ml_model in ML_MODELS:
            if ml_model["name"] == model_to_download:
                model = ml_model
    util.logger.info(f"Downloading model {model['name']}")
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    target_dir = model_folder / model["target-dir"]

    if target_dir.exists():
        util.logger.info(f"Model {model['name']} already downloaded")
    else:
        response = requests.get(model["url"], stream=True)
        if model["unpack-command"] == "tar -zxC":
            with tarfile.open(fileobj=response.raw, mode="r:gz") as tar:
                tar.extractall(path=model_folder)
        else:
            with open(target_dir, "wb") as target_file:
                for chunk in response.iter_content(chunk_size=1024):
                    if chunk:
                        target_file.write(chunk)


def download_models(job_id):
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.result = {"progress": {"current": 0, "target": len(ML_MODELS)}}
    lrj.save()

    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    model_folder.mkdir(parents=True, exist_ok=True)

    for model in ML_MODELS:
        download_model(model)
        lrj.result["progress"]["current"] += 1
        lrj.save()

    lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.finished = True
    lrj.save()


def do_all_models_exist():
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    for model in ML_MODELS:
        target_dir = model_folder / model["target-dir"]
        if not target_dir.exists():
            return False
    return True
