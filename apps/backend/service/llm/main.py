"""
LLM Service for LibrePhotos

This service provides Large Language Model capabilities for image captioning and analysis.

Note: CPU compatibility is checked by the main LibrePhotos application before starting this service.
Services with incompatible CPUs will not be started to prevent performance issues.

Usage:
- Normal operation: python main.py (started by LibrePhotos service manager)
"""

import gevent
import time
from pathlib import Path
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from llama_cpp import Llama

app = Flask(__name__)

# Global model instance and last request time for health monitoring
llm_model = None
current_model_path = None
last_request_time = None


def log(message):
    print(f"llm: {message}")


def load_model(model_path, multimodal=False):
    """Load a model with optional multimodal support"""
    global llm_model, current_model_path

    if llm_model is None or current_model_path != model_path:
        try:
            log(f"Loading model from {model_path}, multimodal: {multimodal}")
            if multimodal:
                # For Moondream, we need to use the chat handler approach
                from llama_cpp.llama_chat_format import MoondreamChatHandler

                # Path to the mmproj file for Moondream
                mmproj_path = "/protected_media/data_models/moondream2-mmproj-f16.gguf"

                if not Path(mmproj_path).exists():
                    raise Exception(f"Moondream mmproj file not found at {mmproj_path}")

                log(f"Loading Moondream chat handler with mmproj: {mmproj_path}")
                chat_handler = MoondreamChatHandler(clip_model_path=mmproj_path)

                llm_model = Llama(
                    model_path=model_path,
                    chat_handler=chat_handler,
                    n_ctx=2048,  # Increase context window for image processing
                    verbose=False,
                )
            else:
                # For text-only models
                llm_model = Llama(model_path=model_path, verbose=False)

            current_model_path = model_path
            log("Model loaded successfully")
        except Exception as e:
            log(f"Error loading model: {str(e)}")
            raise


@app.route("/generate", methods=["POST"])
def generate():
    """Unified endpoint for text and multimodal generation"""
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_data = data.get("image_data")  # Now expects base64 data URI directly
        prompt = data["prompt"]
        max_tokens = data.get("max_tokens", 128)
        model_path = data.get(
            "model_path", "/protected_media/data_models/moondream2-text-model-f16.gguf"
        )
    except Exception as e:
        log(f"Error parsing request: {str(e)}")
        return "", 400

    try:
        if image_data:
            # Multimodal prompt with image using Moondream
            load_model(model_path, multimodal=True)

            response = llm_model.create_chat_completion(
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_data}},
                        ],
                    }
                ],
                max_tokens=max_tokens,
                temperature=0.1,
            )

            response_text = response["choices"][0]["message"]["content"]
        else:
            # Text-only prompt
            load_model(model_path, multimodal=False)

            output = llm_model(
                prompt,
                max_tokens=max_tokens,
                stop=["Q:", "\n"],
                echo=False,
            )
            response_text = (
                output["choices"][0]["text"] if "choices" in output else str(output)
            )

        log("Generated response")
        return {"response": response_text}, 201

    except Exception as e:
        log(f"Error generating response: {str(e)}")
        return {"error": str(e)}, 500


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK", "last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("LLM service with multimodal support starting")
    log(
        "Note: CPU compatibility is verified by LibrePhotos service manager before startup"
    )

    server = WSGIServer(("0.0.0.0", 8008), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
