"""Offline micro-benchmark: ms per image of the scan models (MobileCLIP-S2 image tower, SCRFD, ArcFace)
per execution provider and batch size, random input (OPTIMIZATIONS.md #16).

  <venv with onnxruntime-directml or -gpu>/python gpu_micro.py DmlExecutionProvider|CUDAExecutionProvider|CPUExecutionProvider
  CUDA_DLLS="<cu13 bin>;<cudnn bin>" (CUDA only), THREADS=6 (intra-op threads)
"""
import os, sys, time, json
if os.environ.get("CUDA_DLLS"):
    for d in os.environ["CUDA_DLLS"].split(";"):
        os.add_dll_directory(d)
        os.environ["PATH"] = d + ";" + os.environ["PATH"]
import numpy as np
import onnxruntime as ort
M = r"C:\Users\Niaz\librephotos\rust-pg\ml\protected_media\data_models"
prov = sys.argv[1]
models = {
    "mobileclip": (M + r"\mobileclip_s2\vision_model.onnx", (3, 256, 256)),
    "scrfd": (M + r"\face_recognition\models\buffalo_sc\det_500m.onnx", (3, 640, 640)),
    "arcface": (M + r"\face_recognition\models\buffalo_sc\w600k_mbf.onnx", (3, 112, 112)),
}
so = ort.SessionOptions()
so.intra_op_num_threads = int(os.environ.get("THREADS", "6"))
if prov == "DmlExecutionProvider":
    so.enable_mem_pattern = False
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
out = {}
for name, (path, shape) in models.items():
    s = ort.InferenceSession(path, so, providers=[prov, "CPUExecutionProvider"])
    inp = s.get_inputs()[0]
    print(name, inp.shape, s.get_providers()[0], flush=True)
    for b in [1, 8, 16, 32, 64]:
        if isinstance(inp.shape[0], int) and inp.shape[0] != b:
            if b > 1:
                continue
        x = np.random.rand(b, *shape).astype(np.float32)
        try:
            s.run(None, {inp.name: x}); s.run(None, {inp.name: x})
        except Exception as e:
            print(" b", b, "failed", str(e)[:100]); break
        n = max(3, 64 // b)
        t = time.perf_counter()
        for _ in range(n):
            s.run(None, {inp.name: x})
        ms = (time.perf_counter() - t) / n / b * 1000
        out[f"{name}@{b}"] = round(ms, 2)
        print(f" b{b}: {ms:.2f} ms/img", flush=True)
print(json.dumps(out))
