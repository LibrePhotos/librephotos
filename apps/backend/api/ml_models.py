import math
import os
import tarfile
import uuid
from datetime import datetime
from pathlib import Path

import pytz
import requests
from constance import config as site_config
from django.conf import settings

from api import util
from api.models.long_running_job import LongRunningJob


class MlTypes:
    CAPTIONING = "captioning"
    FACE_RECOGNITION = "face_recognition"
    CATEGORIES = "categories"
    CLIP = "clip"
    LLM = "llm"


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
    {
        "id": 6,
        "name": "blip_base_capfilt_large",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/blip_large.tar.gz?download=true",
        "type": MlTypes.CAPTIONING,
        "unpack-command": "tar -zxC",
        "target-dir": "blip",
    },
    {
        "id": 7,
        "name": "mistral-7b-v0.1.Q5_K_M",
        "url": "https://huggingface.co/TheBloke/Mistral-7B-v0.1-GGUF/resolve/main/mistral-7b-v0.1.Q5_K_M.gguf?download=true",
        "type": MlTypes.LLM,
        "unpack-command": None,
        "target-dir": "mistral-7b-v0.1.Q5_K_M.gguf",
    },
    {
        "id": 8,
        "name": "mistral-7b-instruct-v0.2.Q5_K_M",
        "url": "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q5_K_M.gguf?download=true",
        "type": MlTypes.LLM,
        "unpack-command": None,
        "target-dir": "mistral-7b-instruct-v0.2.Q5_K_M.gguf",
    },
]


def download_model(model):
    model = model.copy()
    if model["type"] == MlTypes.LLM:
        util.logger.info("Downloading LLM model")
        model_to_download = site_config.LLM_MODEL
        if not model_to_download and model_to_download != "none":
            util.logger.info("No LLM model selected")
            return
        util.logger.info(f"Model to download: {model_to_download}")
        # Look through ML_MODELS and find the model with the name
        for ml_model in ML_MODELS:
            if ml_model["name"] == model_to_download:
                model = ml_model
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
        return

    if model["unpack-command"] == "tar -zxC":
        target_dir = model_folder / (model["target-dir"] + ".tar.gz")
    if model["unpack-command"] == "tar -xvf":
        target_dir = model_folder / (model["target-dir"] + ".tar")
    if model["unpack-command"] is None:
        target_dir = model_folder / model["target-dir"]

    response = requests.get(model["url"], stream=True)
    total_size = int(response.headers.get("content-length", 0))
    block_size = 1024
    current_progress = 0
    previous_percentage = -1  # Initialize to a value that won't match any
    with open(target_dir, "wb") as target_file:
        for chunk in response.iter_content(chunk_size=block_size):
            if chunk:
                target_file.write(chunk)
                current_progress += len(chunk)
                percentage = math.floor((current_progress / total_size) * 100)

                if percentage != previous_percentage:
                    util.logger.info(
                        f"Downloading {model['name']}: {current_progress}/{total_size} ({percentage}%)"
                    )
                    previous_percentage = percentage

    if model["unpack-command"] == "tar -zxC":
        with tarfile.open(target_dir, mode="r:gz") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_dir)
    if model["unpack-command"] == "tar -xvf":
        with tarfile.open(target_dir, mode="r:") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_dir)


def download_models(user):
    job_id = uuid.uuid4()
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        queued_at=datetime.now().replace(tzinfo=pytz.utc),
        job_type=LongRunningJob.JOB_DOWNLOAD_MODELS,
    )
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.progress_target = len(ML_MODELS)
    lrj.save()

    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    model_folder.mkdir(parents=True, exist_ok=True)

    for model in ML_MODELS:
        download_model(model)
        lrj.progress_current += 1
        lrj.save()

    lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.finished = True
    lrj.save()


def do_all_models_exist():
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    for model in ML_MODELS:
        target_dir = model_folder / model["target-dir"]
        if model["type"] == MlTypes.LLM:
            if not model and model != "none":
                continue
        if not target_dir.exists():
            return False
    return True
