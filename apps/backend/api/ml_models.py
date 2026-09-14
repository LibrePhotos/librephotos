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
    CLIP = "clip"
    TAGGING = "tagging"
    OCR = "ocr"


class ModelChecksumError(Exception):
    """A downloaded file's sha256 did not match the pinned value.

    Treated exactly like any other failed download: the partial file is
    cleaned up by ``_download_file`` and nothing ever reaches the model dir.
    """


ML_MODELS = [
    {
        # OpenAI CLIP ViT-B/32 for semantic search: the same weights the
        # sentence-transformers clip-ViT-B-32 bundle used to wrap, exported to
        # ONNX, so embeddings already in the database stay comparable.
        "id": 2,
        "name": "clip_vit_b32",
        "url": "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx",
        "type": MlTypes.CLIP,
        "unpack-command": None,
        "target-dir": "clip_vit_b32/vision_model.onnx",
        "sha256": "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40",
        "additional_files": [
            {
                "url": "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model.onnx",
                "target": "clip_vit_b32/text_model.onnx",
                "sha256": "3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc",
            },
            {
                "url": "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json",
                "target": "clip_vit_b32/tokenizer.json",
                "sha256": "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd",
            },
        ],
    },
    {
        # Apple MobileCLIP-S2 (ONNX export by Xenova): the lightweight zero-shot
        # tagger, about the cost of the old Places365 CNN.
        "id": 3,
        "name": "mobileclip_s2",
        "url": "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/vision_model.onnx",
        "type": MlTypes.TAGGING,
        "unpack-command": None,
        "target-dir": "mobileclip_s2/vision_model.onnx",
        "sha256": "d28b92d7a3a6ba99bd000cce5c91678c0e279dc934c887a3785908a811872a6c",
        "additional_files": [
            {
                "url": "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/onnx/text_model.onnx",
                "target": "mobileclip_s2/text_model.onnx",
                "sha256": "ff82e945c6c652c51df687e10f102a8e43c87d37c9108ff692468be3732f3710",
            },
            {
                "url": "https://huggingface.co/Xenova/mobileclip_s2/resolve/main/tokenizer.json",
                "target": "mobileclip_s2/tokenizer.json",
                "sha256": "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85",
            },
        ],
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
        # Liquid AI's LFM2.5-VL-450M (ONNX export by onnx-community, 4-bit
        # weights, fp16 activations): the captioner. A vision-language model,
        # so the caption prompt can carry a person's name and the place. About
        # 0.9 GB of RAM while it captions. Always kept available, so turning
        # captioning on never waits for a download. The .onnx_data files are
        # the weights the small .onnx graphs point at and must keep their
        # names.
        "id": 18,
        "name": "lfm2_vl_450m",
        "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4f16.onnx",
        "type": MlTypes.CAPTIONING,
        "unpack-command": None,
        "target-dir": "lfm2_vl_450m/vision_encoder_q4f16.onnx",
        "sha256": "3b3c649be161ac04196dccf17a6dacbbc5bba27d305dc76df541da971a04b938",
        "additional_files": [
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/vision_encoder_q4f16.onnx_data",
                "target": "lfm2_vl_450m/vision_encoder_q4f16.onnx_data",
                "sha256": "22cafaabfa07020c4426962e2c71aff05fd53b63af971bbbcf094f5cf7c9af07",
            },
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4f16.onnx",
                "target": "lfm2_vl_450m/embed_tokens_q4f16.onnx",
                "sha256": "8b0b2f8ce26a383d2064bac1949f0fee763dfc5625efa6b15166f6b115f23836",
            },
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/embed_tokens_q4f16.onnx_data",
                "target": "lfm2_vl_450m/embed_tokens_q4f16.onnx_data",
                "sha256": "57b12507e5ad10435ae86ff73a7b2ea47119009d63706f3f843c4653b297152a",
            },
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4f16.onnx",
                "target": "lfm2_vl_450m/decoder_model_merged_q4f16.onnx",
                "sha256": "7240383efa592695733484b1e4ec4c0474a652d445280c748baf10b51eceacb8",
            },
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/onnx/decoder_model_merged_q4f16.onnx_data",
                "target": "lfm2_vl_450m/decoder_model_merged_q4f16.onnx_data",
                "sha256": "a93e7fc1821e8aaefc33d30af4299411cf0490456d769795bd30db00cb38be95",
            },
            {
                "url": "https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX/resolve/main/tokenizer.json",
                "target": "lfm2_vl_450m/tokenizer.json",
                "sha256": "d3f7877aa8c9ce603604f2cf78c280c24d8b6087c24669610f3391bcd3f703cf",
            },
        ],
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
]


def _is_model_not_selected(value):
    return not value or str(value).strip().lower() == "none"


def _is_model_selected(model):
    model_type = model["type"]
    if model_type == MlTypes.CAPTIONING:
        # The one captioner is always kept available: it is small, and turning
        # captioning on should never wait for a download.
        return True
    if model_type == MlTypes.TAGGING:
        return model["name"] == site_config.TAGGING_MODEL
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

    _download_missing_additional_files(model_folder, model)


def _download_missing_additional_files(model_folder, model):
    for additional_file in model.get("additional_files") or []:
        additional_target = model_folder / additional_file["target"]
        if additional_target.exists():
            continue
        _download_file(
            additional_file["url"],
            additional_target,
            f"{model['name']} ({additional_file['target']})",
            additional_file.get("sha256"),
        )


def _log_download_progress(
    model_name, current_progress, total_size, previous_percentage
):
    if total_size <= 0:
        return previous_percentage
    percentage = math.floor((current_progress / total_size) * 100)
    if percentage != previous_percentage:
        util.logger.info(
            f"Downloading {model_name}: {current_progress}/{total_size} ({percentage}%)"
        )
    return percentage


def _stream_to_partial(response, partial_path, model_name, hasher):
    total_size = int(response.headers.get("content-length", 0))
    block_size = 1024
    current_progress = 0
    previous_percentage = -1

    with open(partial_path, "wb") as target_file:
        for chunk in response.iter_content(chunk_size=block_size):
            if not chunk:
                continue
            target_file.write(chunk)
            if hasher is not None:
                hasher.update(chunk)
            current_progress += len(chunk)
            previous_percentage = _log_download_progress(
                model_name, current_progress, total_size, previous_percentage
            )

    return current_progress, total_size


def _verify_checksum(hasher, expected_sha256, model_name, url):
    if hasher is None:
        util.logger.debug(f"No sha256 pin for {model_name}; skipping verification")
        return

    actual_sha256 = hasher.hexdigest()
    expected = expected_sha256.lower()
    if actual_sha256 == expected:
        return

    # Named file plus both digests so the operator can tell a corrupted
    # download from a stale pin at a glance.
    message = (
        f"Checksum mismatch for {model_name} from {url}: "
        f"expected sha256 {expected}, got {actual_sha256}"
    )
    util.logger.error(message)
    raise ModelChecksumError(message)


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

            current_progress, total_size = _stream_to_partial(
                response, partial_path, model_name, hasher
            )

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

        _verify_checksum(hasher, expected_sha256, model_name, url)

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
