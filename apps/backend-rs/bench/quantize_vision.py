"""int8 copies of the vision models next to the originals (`<file>.onnx.int8` / `.qdq`, never overwriting;
not `*.onnx`, so the face-pack loader never picks them up).

  python quant.py make        # dynamic (MatMul/Gemm weights int8) for transformer towers,
                              # static QDQ (calibrated on 64 corpus photos) for the conv nets
  python quant.py check       # fp32 vs int8 outputs on the corpus: cosine, tag agreement, timing
"""
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

M = Path(r"C:\Users\Niaz\librephotos\rust-pg\ml\protected_media\data_models")
LIB = Path(r"C:\Users\Niaz\librephotos\rust-pg\ml-foot\lib\foot")
FACES = M / "face_recognition" / "models" / "buffalo_sc"
MODELS = {
    "mobileclip": M / "mobileclip_s2" / "vision_model.onnx",
    "vit": M / "clip_vit_b32" / "vision_model.onnx",
    "arcface": FACES / "w600k_mbf.onnx",
    "scrfd": FACES / "det_500m.onnx",
}


def int8_path(p, kind):
    return p.with_name(p.name + f".{kind}")


def photos(n=None):
    fs = [p for p in sorted(LIB.rglob("*")) if p.suffix.lower() in (".jpg", ".png") and "phone" not in p.parts]
    fs += sorted((LIB / "phone").glob("*.jpg"))[:40]
    return fs[:n] if n else fs


def crop(im, size, flt):
    w, h = im.size
    s = size / min(w, h)
    im = im.resize((max(size, round(w * s)), max(size, round(h * s))), flt)
    w, h = im.size
    l, t = (w - size) // 2, (h - size) // 2
    return im.crop((l, t, l + size, t + size))


def prep(kind, f):
    im = Image.open(f).convert("RGB")
    if kind == "mobileclip":
        a = np.asarray(crop(im, 256, Image.BILINEAR), dtype=np.float32) / 255
    elif kind == "vit":
        mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
        std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
        a = (np.asarray(crop(im, 224, Image.BICUBIC), dtype=np.float32) / 255 - mean) / std
    elif kind == "arcface":
        # A centre crop resized to 112: not an aligned face, but a realistic input distribution
        # for calibration and a fair fp32-vs-int8 comparison.
        a = (np.asarray(crop(im, 112, Image.BILINEAR), dtype=np.float32)[:, :, ::-1] - 127.5) / 127.5
    elif kind == "scrfd":
        im.thumbnail((640, 640))
        canvas = Image.new("RGB", (640, 640))
        canvas.paste(im)
        a = (np.asarray(canvas, dtype=np.float32)[:, :, ::-1] - 127.5) / 128.0
    return np.ascontiguousarray(a.transpose(2, 0, 1))[None]


class Reader:
    def __init__(self, kind, name):
        self.it = iter([{name: prep(kind, f)} for f in photos()[::3][:64]])

    def get_next(self):
        return next(self.it, None)


def make():
    from onnxruntime.quantization import (CalibrationMethod, QuantFormat, QuantType, quantize_dynamic,
                                          quantize_static)
    from onnxruntime.quantization.shape_inference import quant_pre_process
    for kind, src in MODELS.items():
        import onnx
        from onnx import version_converter
        pre = src.with_name(src.stem + ".pre.onnx")
        op13 = src.with_name(src.stem + ".op13.onnx")
        t = time.time()
        # Per-channel QDQ needs DequantizeLinear's axis (opset >= 13).
        onnx.save(version_converter.convert_version(onnx.load(str(src)), 13), str(op13))
        quant_pre_process(str(op13), str(pre), skip_symbolic_shape=True)
        op13.unlink()
        dyn = int8_path(src, "int8")
        if not dyn.exists():
            quantize_dynamic(str(pre), str(dyn), weight_type=QuantType.QInt8, per_channel=False,
                             op_types_to_quantize=["MatMul", "Gemm"] if kind in ("mobileclip", "vit") else None)
        st = int8_path(src, "qdq")
        if not st.exists():
            name = ort.InferenceSession(str(src)).get_inputs()[0].name
            quantize_static(str(pre), str(st), Reader(kind, name), quant_format=QuantFormat.QDQ,
                            activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8, per_channel=True,
                            calibrate_method=CalibrationMethod.MinMax,
                            extra_options={"ActivationSymmetric": False, "WeightSymmetric": True})
        pre.unlink()
        print(kind, "done in", round(time.time() - t), "s;", {p.name: round(p.stat().st_size / 1e6, 1)
                                                              for p in (src, dyn, st)}, flush=True)


def sess(p):
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    return ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])


def softmax_tags(e, tagemb):
    e = e / np.linalg.norm(e)
    s = tagemb @ e * 100
    s = np.exp(s - s.max())
    s /= s.sum()
    order = np.argsort(-s)
    return [int(i) for i in order[:10] if s[i] >= 0.02]


def check():
    tagemb = np.load(M / "mobileclip_s2" / "tag_embeddings.npy")
    fs = photos()
    for kind, src in MODELS.items():
        outs = {}
        for variant in ("fp32", "int8", "qdq"):
            p = src if variant == "fp32" else int8_path(src, variant)
            if not p.exists():
                continue
            s = sess(p)
            name = s.get_inputs()[0].name
            xs = [prep(kind, f) for f in fs]
            s.run(None, {name: xs[0]})
            t = time.time()
            outs[variant] = [s.run(None, {name: x}) for x in xs]
            outs[variant + "_ms"] = (time.time() - t) / len(xs) * 1000
        line = [f"{kind}: fp32 {outs['fp32_ms']:.1f} ms"]
        for v in ("int8", "qdq"):
            if v not in outs:
                continue
            if kind == "scrfd":
                # score maps: max abs diff of the stride-8 scores, and detections above 0.5
                a = np.concatenate([o[0].ravel() for o in outs["fp32"]])
                b = np.concatenate([o[0].ravel() for o in outs[v]])
                line.append(f"{v} {outs[v + '_ms']:.1f} ms, score max diff {np.abs(a - b).max():.3f}, "
                            f">=0.5 cells fp32 {(a >= .5).sum()} vs {(b >= .5).sum()}")
                continue
            cos = [float((x[0].ravel() @ y[0].ravel()) / np.linalg.norm(x[0]) / np.linalg.norm(y[0]))
                   for x, y in zip(outs["fp32"], outs[v])]
            extra = ""
            if kind == "mobileclip":
                same = sum(softmax_tags(x[0][0], tagemb) == softmax_tags(y[0][0], tagemb)
                           for x, y in zip(outs["fp32"], outs[v]))
                top1 = sum(softmax_tags(x[0][0], tagemb)[:1] == softmax_tags(y[0][0], tagemb)[:1]
                           for x, y in zip(outs["fp32"], outs[v]))
                jac = np.mean([len(set(a) & set(b)) / max(1, len(set(a) | set(b))) for a, b in
                               ((softmax_tags(x[0][0], tagemb), softmax_tags(y[0][0], tagemb))
                                for x, y in zip(outs["fp32"], outs[v]))])
                extra = f", tag sets identical {same}/{len(cos)}, top-1 {top1}/{len(cos)}, Jaccard {jac:.3f}"
            line.append(f"{v} {outs[v + '_ms']:.1f} ms, cosine min {min(cos):.4f} mean {np.mean(cos):.4f}{extra}")
        print("; ".join(line), flush=True)


if __name__ == "__main__":
    {"make": make, "check": check}[sys.argv[1]]()
