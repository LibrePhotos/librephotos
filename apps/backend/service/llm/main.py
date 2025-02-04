import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from llama_cpp import Llama

app = Flask(__name__)


def log(message):
    print(f"llm: {message}")


@app.route("/", methods=["POST"])
def generate_prompt():
    try:
        data = request.get_json()
        model_path = data["model_path"]
        prompt = data["prompt"]
        max_tokens = data["max_tokens"]
    except Exception:
        return "", 400

    llm = Llama(model_path=model_path)
    output = llm(
        prompt,  # Prompt
        max_tokens=max_tokens,  # Generate up to 32 tokens
        stop=[
            "Q:",
            "\n",
        ],  # Stop generating just before the model would generate a new question
        echo=False,  # Echo the prompt back in the output
    )  # Generate a completion, can also call create_completion

    log(output)
    return {"prompt": output}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8008), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
