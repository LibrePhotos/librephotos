#!/usr/bin/env bash
# sidecars.sh <media dir>: stub captioner files, so generateim2txt gets past
# its "is the model downloaded" check on both servers (the mock answers).
set -euo pipefail
d="$1/protected_media/data_models/lfm2_vl_450m"
mkdir -p "$d"
for f in vision_encoder_q4.onnx vision_encoder_q4.onnx_data embed_tokens_q4.onnx embed_tokens_q4.onnx_data \
    decoder_model_merged_q4.onnx decoder_model_merged_q4.onnx_data tokenizer.json; do
    : > "$d/$f"
done
