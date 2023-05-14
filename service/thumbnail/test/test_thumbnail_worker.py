import os

from pytest import fixture

from service.thumbnail.main import app


@fixture()
def client():
    return app.test_client()


def test_must_fail_when_passing_empty_string(client):
    response = client.post("/", data="")
    assert response.status_code == 400


def test_must_fail_when_passing_invalid_json(client):
    response = client.post("/", data="invalid json")
    assert response.status_code == 400


def test_must_fail_when_passing_incomplete_json(client):
    invalid_payloads = [
        {"source": "foo"},
        {"destination": "/tmp/result.webp"},
        {"height": 100},
        {"source": "foo", "destination": "/tmp/result.webp"},
        {"destination": "/tmp/result.webp", "height": 100},
        {"height": 100, "source": "foo"},
    ]
    for payload in invalid_payloads:
        response = client.post("/", json=payload)
        assert response.status_code == 400


def test_should_create_thumbnail(client):
    samples_dir = os.path.join(os.path.dirname(os.path.realpath(__file__)), "samples")
    samples = [f for f in os.listdir(samples_dir) if f not in [".gitkeep", "README.md"]]
    thumbnail_path = "/tmp/result.webp"
    for sample in samples:
        if os.path.exists(thumbnail_path):
            os.remove(thumbnail_path)
        source = os.path.join(samples_dir, sample)
        json = {"source": source, "destination": thumbnail_path, "height": 100}
        response = client.post("/", json=json)
        assert response.status_code == 201
