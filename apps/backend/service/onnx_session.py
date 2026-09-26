"""ONNX Runtime sessions for the ML sidecars: which device, how many threads.

Every model the sidecars run (CLIP, MobileCLIP, SigLIP 2, LFM2-VL, PP-OCR,
insightface) used to pin CPUExecutionProvider, so the GPU image installed
onnxruntime-gpu and never used it. The providers now come from what the
installed onnxruntime offers, CUDA first:

``ONNX_PROVIDERS``
    Comma-separated execution providers in order of preference, e.g.
    ``CPUExecutionProvider`` to keep a GPU image off the GPU. Names this
    onnxruntime build does not offer are skipped. Unset: CUDA when available,
    then CPU.
``ONNX_INTRA_OP_THREADS``
    Threads one session may use inside an operator. Unset or 0: onnxruntime's
    default, one per physical core. The face models are the exception:
    insightface builds their sessions itself and passes no options through.

The sidecars are scripts started as ``python service/<name>/main.py``;
api.services puts the backend root on their PYTHONPATH so this module imports
as ``service.onnx_session`` there as in the tests and the standalone build.
"""

import os

import onnxruntime as ort

CPU = "CPUExecutionProvider"
CUDA = "CUDAExecutionProvider"
DEFAULT_PROVIDERS = (CUDA, CPU)


def _requested_providers():
    value = os.environ.get("ONNX_PROVIDERS", "")
    return [name.strip() for name in value.split(",") if name.strip()]


def execution_providers():
    """The providers to create sessions with, most preferred first."""
    available = ort.get_available_providers()
    preferred = _requested_providers() or DEFAULT_PROVIDERS
    providers = [name for name in preferred if name in available]
    return providers or [CPU]


def uses_gpu(providers=None):
    """Whether sessions will run on CUDA (insightface wants a ctx_id for it)."""
    return CUDA in (execution_providers() if providers is None else providers)


def intra_op_threads():
    """ONNX_INTRA_OP_THREADS as a positive int, or None for the ORT default."""
    try:
        threads = int(os.environ.get("ONNX_INTRA_OP_THREADS", "") or 0)
    except ValueError:
        return None
    return threads if threads > 0 else None


def session_options():
    options = ort.SessionOptions()
    threads = intra_op_threads()
    if threads is not None:
        options.intra_op_num_threads = threads
    return options


def inference_session(path):
    """An InferenceSession for *path* on the configured providers."""
    return ort.InferenceSession(
        path, sess_options=session_options(), providers=execution_providers()
    )
