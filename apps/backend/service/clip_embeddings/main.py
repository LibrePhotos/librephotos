import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from semantic_search.semantic_search import semantic_search_instance

app = Flask(__name__)


def log(message):
    print("clip embeddings: {}".format(message))


@app.route("/clip-embeddings", methods=["POST"])
def create_clip_embeddings():
    try:
        data = request.get_json()
        imgs = data["imgs"]
        model = data["model"]
    except Exception as e:
        print(str(e))
        return "", 400
    imgs_emb, magnitudes = semantic_search_instance.calculate_clip_embeddings(
        imgs, model
    )
    # Convert NumPy arrays to Python lists
    imgs_emb_list = [enc.tolist() for enc in imgs_emb]
    magnitudes = [float(m) for m in magnitudes]
    return {"imgs_emb": imgs_emb_list, "magnitudes": magnitudes}, 201


@app.route("/query-embeddings", methods=["POST"])
def calculate_query_embeddings():
    try:
        data = request.get_json()
        query = data["query"]
        model = data["model"]
    except Exception as e:
        print(str(e))
        return "", 400
    emb, magnitude = semantic_search_instance.calculate_query_embeddings(query, model)
    return {"emb": emb, "magnitude": magnitude}, 201


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8006), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
