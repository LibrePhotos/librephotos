import math
import os
import tarfile
from pathlib import Path

import requests
from constance import config as site_config
from django.conf import settings

from api import util
from api.models.long_running_job import LongRunningJob


class MlTypes:
    FACE_RECOGNITION = "face_recognition"
    LLM = "llm"
    CAPTIONING = "captioning"
    TAGGING = "tagging"


ML_MODELS = [
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
        "id": 9,
        "name": "smolvlm-256m",
        "url": "https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/SmolVLM-256M-Instruct-f16.gguf?download=true",
        "type": MlTypes.CAPTIONING,
        "unpack-command": None,
        "target-dir": "SmolVLM-256M-Instruct-f16.gguf",
        "additional_files": [
            {
                "url": "https://huggingface.co/ggml-org/SmolVLM-256M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-256M-Instruct-f16.gguf?download=true",
                "target": "mmproj-SmolVLM-256M-Instruct-f16.gguf",
            }
        ],
    },
]


def download_model(model):
    model = model.copy()
    if model["type"] == MlTypes.LLM:
        util.logger.info("Downloading LLM model")
        model_to_download = site_config.LLM_MODEL
        if not model_to_download or str(model_to_download).strip().lower() == "none":
            util.logger.info("No LLM model selected")
            return
        util.logger.info(f"Model to download: {model_to_download}")
        # Look through ML_MODELS and find the model with the name
        selected_model = None
        for ml_model in ML_MODELS:
            if ml_model["name"] == model_to_download:
                selected_model = ml_model
                break
        if selected_model is None:
            util.logger.warning(f"Unknown LLM model selected: {model_to_download}")
            return
        model = selected_model
    elif model["type"] == MlTypes.CAPTIONING:
        util.logger.info("Downloading captioning model")
        model_to_download = str(site_config.CAPTIONING_MODEL).strip().lower()
        if model_to_download != model["name"]:
            util.logger.info(
                f"Captioning model {model['name']} not selected (current: {model_to_download})"
            )
            return
        util.logger.info(f"Model to download: {model_to_download}")
    elif model["type"] == MlTypes.TAGGING:
        util.logger.info("Downloading tagging model")
        model_to_download = site_config.TAGGING_MODEL
        if model_to_download != model["name"]:
            util.logger.info(
                f"Tagging model {model['name']} not selected (current: {model_to_download})"
            )
            return
        util.logger.info(f"Model to download: {model_to_download}")

    util.logger.info(f"Downloading model {model['name']}")
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"

    # Handle regular models
    target_dir = model_folder / model["target-dir"]

    if target_dir.exists():
        util.logger.info(f"Model {model['name']} already downloaded")
        # Check if all additional files exist for multimodal models
        if model.get("additional_files"):
            for additional_file in model["additional_files"]:
                additional_target = model_folder / additional_file["target"]
                if not additional_target.exists():
                    util.logger.info(
                        f"Additional file {additional_file['target']} missing, downloading..."
                    )
                    _download_file(
                        additional_file["url"],
                        additional_target,
                        f"{model['name']} ({additional_file['target']})",
                    )
        return

    if model["unpack-command"] == "tar -zxC":
        target_dir = model_folder / (model["target-dir"] + ".tar.gz")
    elif model["unpack-command"] == "tar -xvf":
        target_dir = model_folder / (model["target-dir"] + ".tar")
    elif model["unpack-command"] is None:
        target_dir = model_folder / model["target-dir"]

    _download_file(model["url"], target_dir, model["name"])

    if model["unpack-command"] == "tar -zxC":
        with tarfile.open(target_dir, mode="r:gz") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_dir)
    if model["unpack-command"] == "tar -xvf":
        with tarfile.open(target_dir, mode="r:") as tar:
            tar.extractall(path=model_folder)
        os.remove(target_dir)

    # Download additional files if they exist (e.g., mmproj for multimodal models)
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
    for model in ML_MODELS:
        model_name = model["name"]

        if model["type"] == MlTypes.LLM:
            selected_llm = str(site_config.LLM_MODEL).strip().lower()
            if selected_llm == "none" or selected_llm != model_name.lower():
                continue

        if model["type"] == MlTypes.CAPTIONING:
            captioning_model = str(site_config.CAPTIONING_MODEL).strip().lower()
            if captioning_model != model_name.lower():
                continue

        # Check main model file
        target_dir = model_folder / model["target-dir"]
        if not target_dir.exists():
            return False

        # Check additional files if they exist for multimodal models.
        if model.get("additional_files"):
            for additional_file in model["additional_files"]:
                additional_target = model_folder / additional_file["target"]
                if not additional_target.exists():
                    return False
    return True
