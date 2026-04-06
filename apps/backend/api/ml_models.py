import math
import os
import tarfile
import zipfile
from pathlib import Path

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
    MOONDREAM = "moondream"
    TAGGING = "tagging"


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
        "name": "buffalo_sc",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_sc",
    },
    {
        "id": 7,
        "name": "buffalo_s",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_s",
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
        "id": 10,
        "name": "buffalo_m",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_m.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_m",
    },
    {
        "id": 8,
        "name": "mistral-7b-instruct-v0.2.Q5_K_M",
        "url": "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q5_K_M.gguf?download=true",
        "type": MlTypes.LLM,
        "unpack-command": None,
        "target-dir": "mistral-7b-instruct-v0.2.Q5_K_M.gguf",
    },
    {
        "id": 11,
        "name": "siglip2",
        "url": "https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/vision_model.onnx",
        "type": MlTypes.TAGGING,
        "unpack-command": None,
        "target-dir": "siglip2/vision_model.onnx",
        "additional_files": [
            {
                "url": "https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/onnx/text_model.onnx",
                "target": "siglip2/text_model.onnx",
            },
            {
                "url": "https://huggingface.co/onnx-community/siglip2-base-patch16-384-ONNX/resolve/main/tokenizer.model",
                "target": "siglip2/tokenizer.model",
            },
        ],
    },
    {
        "id": 12,
        "name": "buffalo_l",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_l",
    },
    {
        "id": 13,
        "name": "antelopev2",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/antelopev2",
    },
    {
        # Moondream 2 GGUF model for llama-cpp-python multimodal support
        "id": 9,
        "name": "moondream",
        "url": "https://huggingface.co/moondream/moondream-2b-2025-04-14-4bit/resolve/main/moondream2-text-model-f16.gguf?download=true",
        "type": MlTypes.MOONDREAM,
        "unpack-command": None,
        "target-dir": "moondream2-text-model-f16.gguf",
        "additional_files": [
            {
                "url": "https://huggingface.co/moondream/moondream-2b-2025-04-14-4bit/resolve/main/moondream2-mmproj-f16.gguf?download=true",
                "target": "moondream2-mmproj-f16.gguf",
            }
        ],
    },
]


def _is_model_not_selected(value):
    return not value or str(value).strip().lower() == "none"


def _is_model_selected(model):
    model_type = model["type"]
    if model_type == MlTypes.CAPTIONING:
        return model["name"] == site_config.CAPTIONING_MODEL
    if model_type == MlTypes.TAGGING:
        return model["name"] == site_config.TAGGING_MODEL
    if model_type == MlTypes.LLM:
        return not _is_model_not_selected(site_config.LLM_MODEL) and (
            model["name"] == site_config.LLM_MODEL
        )
    if model_type == MlTypes.MOONDREAM:
        return site_config.LLM_MODEL == model["name"]
    if model_type == MlTypes.FACE_RECOGNITION:
        return model["name"] == site_config.FACE_RECOGNITION_MODEL
    return True


def _iter_required_models():
    for model in ML_MODELS:
        if _is_model_selected(model):
            yield model


def _get_download_target(model_folder, model):
    if model["unpack-command"] == "tar -zxC":
        return model_folder / (model["target-dir"] + ".tar.gz")
    if model["unpack-command"] == "tar -xvf":
        return model_folder / (model["target-dir"] + ".tar")
    if model["unpack-command"] == "zip":
        return model_folder / (model["target-dir"] + ".zip")
    return model_folder / model["target-dir"]


def _model_target_exists(model_folder, model):
    target_dir = model_folder / model["target-dir"]
    if not target_dir.exists():
        return False

    if model["type"] == MlTypes.FACE_RECOGNITION and not any(
        target_dir.glob("*.onnx")
    ):
        return False

    if model.get("additional_files"):
        for additional_file in model["additional_files"]:
            additional_target = model_folder / additional_file["target"]
            if not additional_target.exists():
                return False
    return True


def download_model(model):
    model = model.copy()
    if not _is_model_selected(model):
        util.logger.info(f"Skipping unselected model {model['name']}")
        return

    util.logger.info(f"Downloading model {model['name']}")
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"

    if _model_target_exists(model_folder, model):
        util.logger.info(f"Model {model['name']} already downloaded")
        return

    target_path = _get_download_target(model_folder, model)

    _download_file(model["url"], target_path, model["name"])

    if model["unpack-command"] == "tar -zxC":
        with tarfile.open(target_path, mode="r:gz") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_path)
    if model["unpack-command"] == "tar -xvf":
        with tarfile.open(target_path, mode="r:") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_path)
    if model["unpack-command"] == "zip":
        target_dir = model_folder / model["target-dir"]
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target_path) as archive:
            archive.extractall(path=target_dir)
        os.remove(target_path)

    if model.get("additional_files"):
        for additional_file in model["additional_files"]:
            additional_target = model_folder / additional_file["target"]
            if not additional_target.exists():
                _download_file(
                    additional_file["url"],
                    additional_target,
                    f"{model['name']} ({additional_file['target']})",
                )


def _download_file(url, target_path, model_name):
    """Helper function to download a single file with progress tracking"""
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(url, stream=True, allow_redirects=True)
    total_size = int(response.headers.get("content-length", 0))
    block_size = 1024
    current_progress = 0
    previous_percentage = -1

    with open(target_path, "wb") as target_file:
        for chunk in response.iter_content(chunk_size=block_size):
            if chunk:
                target_file.write(chunk)
                current_progress += len(chunk)

                if total_size > 0:
                    percentage = math.floor((current_progress / total_size) * 100)

                    if percentage != previous_percentage:
                        util.logger.info(
                            f"Downloading {model_name}: {current_progress}/{total_size} ({percentage}%)"
                        )
                        previous_percentage = percentage

    if total_size == 0:
        util.logger.info(
            f"Downloaded {model_name}: {current_progress} bytes (size unknown during transfer)"
        )


def download_models(user):
    lrj = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_DOWNLOAD_MODELS,
        start_now=True,
    )
    lrj.update_progress(current=0, target=len(ML_MODELS))

    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    model_folder.mkdir(parents=True, exist_ok=True)

    for idx, model in enumerate(ML_MODELS):
        download_model(model)
        lrj.update_progress(current=idx + 1)

    lrj.complete()


def do_all_models_exist():
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    for model in _iter_required_models():
        if not _model_target_exists(model_folder, model):
            return False
    return True
