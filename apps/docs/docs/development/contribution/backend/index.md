---
title: "☁️ Backend"
description: "Development Information regarding LibrePhotos Backend."
sidebar_position: 1
last_modified_at: 2020-08-04
---

The backend uses the following technologies:

- Python
- Django
- Pytorch

## ✨ Code Standards

In order to keep the code consistently structured, the backend has a pre-commit hook. Run `pre-commit install` from `apps/backend/` and the linter and the formatter will check your work before you commit.

We use [ruff](https://docs.astral.sh/ruff/) for both linting and formatting, configured in `apps/backend/pyproject.toml`. You can also run it by hand with `ruff check .` and `ruff format .`.

## 🐛 Debugging

Usually nothing goes as planned, and you need to debug your shiny new feature. In the next paragraph, I will explain to you the two tools we have for debugging:

### Using pdb

Add the following in the python code where you want a breakpoint:

```
import pdb; pdb.set_trace()
```

Attach to the backend service:

```
docker attach $(docker ps --filter name=backend -q)
```

Debug as normal in pdb!

When you're done debugging, continue execution (c) and press Ctrl-P followed by Ctrl-Q to detach from the container without stopping it.

### Using silk

In order to debug queries, start the backend container in dev mode. Then you can access silk under /api/silk. Silk is a live profiling and inspection tool for the Django framework. Silk intercepts and stores HTTP requests and database queries before presenting them in a user interface for further inspection.

## 🏙️ Structure

There are a lot of folders in our backend. Here is a quick rundown on where you can find what. The Django project itself — settings (`librephotos/settings/`), URL routing (`librephotos/urls.py`) and `wsgi.py` — lives in the `librephotos/` folder, with supporting pieces in `scripts/`, `chunked_upload/` and `nextcloud/`.

### Django

Most of the application code is within the API folder using Django. In the following section, I will explain where you can find what

#### management

This exposes all the commands that you can use via the command line. If you want a new command, that's the place to add it.

#### migrations

Every time we change our models, we have to migrate the database. We use Django migration feature to create migration files to migrate without the headaches.

#### models

Here are the actual data types. If you want to figure out how a photo works or how faces are connected to persons, then this is your folder.

#### views

Here you can find our API implemented. They are separated, similar to the models. Views that expose the photos will be here in photos too.

#### serializers

You have your python model and want to somehow convert that to JSON. That's what the serializer does!

### Services

Not everything runs inside Django. The heavy machine-learning work lives in standalone Flask processes that Django talks to over plain HTTP on localhost. Seven of them sit under `service/` — `thumbnail`, `face_recognition`, `clip_embeddings`, `image_captioning`, `llm`, `exif` and `tags` — and `image_similarity/` is a separate top-level folder. Each is served by a gevent `WSGIServer` on a fixed port; the ports are defined in the `SERVICES` dict in `api/services.py` (image_similarity 8002, thumbnail 8003, face_recognition 8005, clip_embeddings 8006, image_captioning 8007, llm 8008, exif 8010, tags 8011).

You start them with `python manage.py start_service`, which also schedules `api.services.check_services` in django-q2 to poll each service's `/health` endpoint and restart any that have gone stale or died. The `llm` service additionally needs certain CPU features (`avx`, `sse4_2`) and is skipped on hardware that lacks them.

Because these are separate processes, the `docker attach` + pdb trick above does not reach them — to debug a service, check its log under `/logs/` or add logging in the service's own `main.py`.

### Machine Learning

We use as a base framework PyTorch. If you find a cool machine learning model with PyTorch, we sure can add that too.

#### Image Captioning

Captions are generated on demand by the image captioning service (`service/image_captioning/`, port 8007). The model is chosen with the `Captioning Model` site setting (`im2txt` by default, or `none` to turn caption generation off):

- **im2txt** — the original PyTorch captioning model. It still works, though its output is fairly basic.
- **blip_base_capfilt_large** (BLIP) — a newer captioning model. It is not a separate service; it lives inside the image captioning service at `service/image_captioning/api/im2txt/blip/` and is selected by passing `blip=True` through to the model.
- **moondream** — a visual LLM. This one does not go through the captioning service at all: `api/image_captioning.py` routes it to the `llm` service (port 8008).

Whichever model runs, the caption is stored under the `"im2txt"` key in `PhotoCaption.captions_json`, and if an LLM is enabled it can post-process the caption before it is saved. For the user-facing comparison of these models, see the [image captioning guide](../../../user-guide/image-captioning.md).

#### Face Recognition

We use [InsightFace](https://github.com/deepinsight/insightface) to detect and recognise faces, running on ONNX Runtime: an SCRFD detector finds the faces and an ArcFace model turns each one into a 512-dimension embedding. This replaced the previous dlib / `face_recognition` pipeline (which produced 128-dimension encodings). The model is selectable via the `Face Recognition Model` site setting (`buffalo_sc` by default). Unknown faces are grouped with automatic clustering, and a separate classification step matches faces against already-labelled people.

#### Tagging Models

The tags service (`service/tags/`) generates auto-tags for photos. Two models are available, selectable via the Tagging Model site setting:

- **places365** — Scene classification using the Places365 CNN. Generates scene category tags (e.g. "kitchen", "beach").
- **siglip2** (`service/tags/siglip2/`) — Google's SigLIP 2 vision-language model running as ONNX. Uses zero-shot classification by computing cosine similarity between image embeddings and a curated vocabulary of 900+ text tag embeddings. Tag embeddings are cached to disk after the first run. Returns the top 10 tags.

Tags from each model are stored independently in `PhotoCaption.captions_json` under their model key (e.g. `"places365"`, `"siglip2"`), so switching models does not require regeneration.

#### Semantic Search

Here you can find the code which allows us to search semantically for images like "trees in a valley".
