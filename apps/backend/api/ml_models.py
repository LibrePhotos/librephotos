import hashlib
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
    OCR = "ocr"


class ModelChecksumError(Exception):
    """A downloaded file's sha256 did not match the pinned value.

    Treated exactly like any other failed download: the partial file is
    cleaned up by ``_download_file`` and nothing ever reaches the model dir.
    """


ML_MODELS = [
    {
        "id": 1,
        "name": "im2txt",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/im2txt.tar.gz",
        "type": MlTypes.CAPTIONING,
        "unpack-command": "tar -zxC",
        "target-dir": "im2txt",
        "sha256": "980670c0365c0e32b5fecfc0907bfee4742bcd6a40e0d6ac5692c69bbd49ccc4",
    },
    {
        "id": 2,
        "name": "clip-embeddings",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/clip-embeddings.tar.gz",
        "type": MlTypes.CLIP,
        "unpack-command": "tar -zxC",
        "target-dir": "clip-embeddings",
        "sha256": "3d2f66350b75127024603dfaff55d4b981461363072d9697aa88d472440ecb4e",
    },
    {
        "id": 3,
        "name": "places365",
        "url": "https://github.com/LibrePhotos/librephotos-docker/releases/download/0.1/places365.tar.gz",
        "type": MlTypes.CATEGORIES,
        "unpack-command": "tar -zxC",
        "target-dir": "places365",
        "sha256": "27792ffcd1f6a4de7abebdea046dda0916f9cd12eba7bed7b5f51f120f91f0d8",
    },
    {
        "id": 4,
        "name": "resnet18",
        "url": "https://download.pytorch.org/models/resnet18-5c106cde.pth",
        "type": MlTypes.CATEGORIES,
        "unpack-command": None,
        "target-dir": "resnet18-5c106cde.pth",
        "sha256": "5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8",
    },
    {
        # InsightFace buffalo_* and antelopev2 bundles are licensed for
        # NON-COMMERCIAL RESEARCH USE ONLY, so they deliberately stay on their
        # upstream github.com/deepinsight release URLs and are NOT mirrored to
        # the LibrePhotos Hugging Face mirror.
        "id": 5,
        "name": "buffalo_sc",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_sc",
        "sha256": "57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72",
    },
    {
        "id": 7,
        "name": "buffalo_s",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_s",
        "sha256": "d85a87f503f691807cd8bb97128bdf7a0660326cd9cd02657127fa978bab8b5e",
    },
    {
        "id": 6,
        "name": "blip_base_capfilt_large",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/blip_large.tar.gz?download=true",
        "type": MlTypes.CAPTIONING,
        "unpack-command": "tar -zxC",
        "target-dir": "blip",
        "sha256": "7c730d83bfdf4def7e9cca070e88b89192e61b8b1e7b64179b182e03922179f8",
    },
    {
        "id": 10,
        "name": "buffalo_m",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_m.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/buffalo_m",
        "sha256": "d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9",
    },
    {
        "id": 8,
        "name": "mistral-7b-instruct-v0.2.Q5_K_M",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/mistral/mistral-7b-instruct-v0.2.Q5_K_M.gguf?download=true",
        "type": MlTypes.LLM,
        "unpack-command": None,
        "target-dir": "mistral-7b-instruct-v0.2.Q5_K_M.gguf",
        "sha256": "b85cdd596ddd76f3194047b9108a73c74d77ba04bef49255a50fc0cfbda83d32",
    },
    {
        "id": 11,
        "name": "siglip2",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/vision_model.onnx",
        "type": MlTypes.TAGGING,
        "unpack-command": None,
        "target-dir": "siglip2/vision_model.onnx",
        "sha256": "49ae4958b1098ca995e929d646f7be05a69c65e6344beae07d58c6598ffc5210",
        "additional_files": [
            {
                "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/text_model.onnx",
                "target": "siglip2/text_model.onnx",
                "sha256": "d28c21c7f12c38b0ec43aacb7ce2228fba6bd6b20641802ef2b29809ece46af8",
            },
            {
                "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/siglip2/tokenizer.model",
                "target": "siglip2/tokenizer.model",
                "sha256": "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2",
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
        "sha256": "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f",
    },
    {
        "id": 13,
        "name": "antelopev2",
        "url": "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
        "type": MlTypes.FACE_RECOGNITION,
        "unpack-command": "zip",
        "target-dir": "face_recognition/models/antelopev2",
        "sha256": "8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5",
    },
    {
        "id": 14,
        "name": "ppocrv6_tiny",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_tiny.tar.gz?download=true",
        "type": MlTypes.OCR,
        "unpack-command": "tar -zxC",
        "target-dir": "ocr/ppocrv6_tiny",
        "sha256": "7e534d86a0cb6335c769993f6fd9a29f752b6ed98e93f60808649870baa5440b",
    },
    {
        "id": 15,
        "name": "ppocrv6_small",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_small.tar.gz?download=true",
        "type": MlTypes.OCR,
        "unpack-command": "tar -zxC",
        "target-dir": "ocr/ppocrv6_small",
        "sha256": "241769eb7750b4a43141a509bee8ac6893517c8b41ec3b5e5c45bdd4fde47c21",
    },
    {
        "id": 16,
        "name": "ppocrv6_medium",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/ppocrv6_medium.tar.gz?download=true",
        "type": MlTypes.OCR,
        "unpack-command": "tar -zxC",
        "target-dir": "ocr/ppocrv6_medium",
        "sha256": "21232b79847cd56d5cae801d3364f95e508b40bb0ce159f31687e63c63959a0b",
    },
    {
        # Moondream 2 GGUF model for llama-cpp-python multimodal support
        "id": 9,
        "name": "moondream",
        "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/moondream/moondream2-text-model-f16.gguf?download=true",
        "type": MlTypes.MOONDREAM,
        "unpack-command": None,
        "target-dir": "moondream2-text-model-f16.gguf",
        "sha256": "4e17e9107fb8781629b3c8ce177de57ffeae90fe14adcf7b99f0eef025889696",
        "additional_files": [
            {
                "url": "https://huggingface.co/derneuere/librephotos_models/resolve/main/moondream/moondream2-mmproj-f16.gguf?download=true",
                "target": "moondream2-mmproj-f16.gguf",
                "sha256": "4cc1cb3660d87ff56432ebeb7884ad35d67c48c7b9f6b2856f305e39c38eed8f",
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
        # Moondream can be picked as the captioning model, as the LLM, or both.
        return model["name"] in (
            site_config.CAPTIONING_MODEL,
            site_config.LLM_MODEL,
        )
    if model_type == MlTypes.FACE_RECOGNITION:
        return model["name"] == site_config.FACE_RECOGNITION_MODEL
    if model_type == MlTypes.OCR:
        return not _is_model_not_selected(site_config.OCR_MODEL) and (
            model["name"] == site_config.OCR_MODEL
        )
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

    if model["type"] == MlTypes.FACE_RECOGNITION and not any(target_dir.glob("*.onnx")):
        return False

    # A tar bundle is unpacked file-by-file, so a crash mid-extraction can leave
    # target_dir present but incomplete. Require the four core OCR members so a
    # half-extracted bundle is not mistaken for a finished install.
    if model["type"] == MlTypes.OCR:
        required_files = ("det.onnx", "rec.onnx", "charset.txt", "config.json")
        if not all((target_dir / name).exists() for name in required_files):
            return False

    if model.get("additional_files"):
        for additional_file in model["additional_files"]:
            additional_target = model_folder / additional_file["target"]
            if not additional_target.exists():
                return False
    return True


def _unpack_archive(archive_path, model_folder, model):
    unpack_command = model["unpack-command"]
    if unpack_command == "tar -zxC":
        with tarfile.open(archive_path, mode="r:gz") as tar:
            tar.extractall(path=model_folder)
    elif unpack_command == "tar -xvf":
        with tarfile.open(archive_path, mode="r:") as tar:
            tar.extractall(path=model_folder)
    elif unpack_command == "zip":
        target_dir = model_folder / model["target-dir"]
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(path=target_dir)


def download_model(model):
    model = model.copy()
    if not _is_model_selected(model):
        util.logger.info(f"Skipping unselected model {model['name']}")
        return

    model_folder = Path(settings.MEDIA_ROOT) / "data_models"

    if _model_target_exists(model_folder, model):
        util.logger.info(f"Model {model['name']} already downloaded")
        return

    util.logger.info(f"Downloading model {model['name']}")
    target_path = _get_download_target(model_folder, model)

    _download_file(model["url"], target_path, model["name"], model.get("sha256"))

    if model["unpack-command"]:
        try:
            _unpack_archive(target_path, model_folder, model)
        finally:
            # Drop the archive whether or not extraction worked: a corrupt one
            # left behind is never useful and would only be re-read next run.
            Path(target_path).unlink(missing_ok=True)

    if model.get("additional_files"):
        for additional_file in model["additional_files"]:
            additional_target = model_folder / additional_file["target"]
            if not additional_target.exists():
                _download_file(
                    additional_file["url"],
                    additional_target,
                    f"{model['name']} ({additional_file['target']})",
                    additional_file.get("sha256"),
                )


def _download_file(url, target_path, model_name, expected_sha256=None):
    """Download a single file with progress tracking.

    The download is streamed to a temporary sibling and only moved into place
    once it completed successfully. Nothing that is not a fully downloaded file
    ever reaches ``target_path``, so a failed transfer cannot leave behind a
    corrupt archive or - worse, for models that are stored unpacked - a file
    that later checks happily accept as an installed model.

    When ``expected_sha256`` is given, the digest is computed over the streamed
    bytes and compared before the file is moved into place (so archives are
    verified before they are unpacked and plain files before they land at their
    final path). A mismatch is treated exactly like any other failed download:
    the partial file is removed and nothing reaches ``target_path``. Entries
    without a pin skip verification so a future hashless entry cannot crash the
    download.
    """
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = target_path.with_name(target_path.name + ".part")

    hasher = hashlib.sha256() if expected_sha256 else None

    try:
        with requests.get(url, stream=True, allow_redirects=True) as response:
            # Error responses have a body too. Without this check a "404: Entry
            # not found" page gets written out as if it were the model.
            response.raise_for_status()

            total_size = int(response.headers.get("content-length", 0))
            block_size = 1024
            current_progress = 0
            previous_percentage = -1

            with open(partial_path, "wb") as target_file:
                for chunk in response.iter_content(chunk_size=block_size):
                    if chunk:
                        target_file.write(chunk)
                        if hasher is not None:
                            hasher.update(chunk)
                        current_progress += len(chunk)

                        if total_size > 0:
                            percentage = math.floor(
                                (current_progress / total_size) * 100
                            )

                            if percentage != previous_percentage:
                                util.logger.info(
                                    f"Downloading {model_name}: {current_progress}/{total_size} ({percentage}%)"
                                )
                                previous_percentage = percentage

            # content-length describes the encoded body, so it only bounds the
            # bytes we wrote when requests did not decompress on the fly.
            content_encoding = response.headers.get(
                "content-encoding", "identity"
            ).lower()
            is_decoded = content_encoding not in ("", "identity")

        if total_size > 0 and not is_decoded and current_progress != total_size:
            raise OSError(
                f"Incomplete download for {model_name}: got {current_progress} of "
                f"{total_size} bytes from {url}"
            )

        if hasher is not None:
            actual_sha256 = hasher.hexdigest()
            expected = expected_sha256.lower()
            if actual_sha256 != expected:
                # Named file plus both digests so the operator can tell a
                # corrupted download from a stale pin at a glance.
                util.logger.error(
                    f"Checksum mismatch for {model_name} from {url}: "
                    f"expected sha256 {expected}, got {actual_sha256}"
                )
                raise ModelChecksumError(
                    f"Checksum mismatch for {model_name} from {url}: "
                    f"expected sha256 {expected}, got {actual_sha256}"
                )
        else:
            util.logger.debug(f"No sha256 pin for {model_name}; skipping verification")

        if total_size == 0:
            util.logger.info(
                f"Downloaded {model_name}: {current_progress} bytes (size unknown during transfer)"
            )

        os.replace(partial_path, target_path)
    except Exception:
        partial_path.unlink(missing_ok=True)
        raise


def download_models(user):
    lrj = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_DOWNLOAD_MODELS,
        start_now=True,
    )
    lrj.update_progress(current=0, target=len(ML_MODELS))

    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    model_folder.mkdir(parents=True, exist_ok=True)

    failures = []
    for idx, model in enumerate(ML_MODELS):
        try:
            download_model(model)
        except Exception as error:
            # download_models is chained ahead of scans and setup steps, so a
            # single unavailable model must not take the rest of the chain -
            # or the job status - down with it.
            util.logger.exception(f"Failed to download model {model['name']}")
            failures.append(f"{model['name']}: {error}")
        lrj.update_progress(current=idx + 1)

    if failures:
        lrj.fail("Failed to download " + ", ".join(failures))
        return

    lrj.complete()


def do_all_models_exist():
    model_folder = Path(settings.MEDIA_ROOT) / "data_models"
    for model in _iter_required_models():
        if not _model_target_exists(model_folder, model):
            return False
    return True
