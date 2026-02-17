---
title: "☁️ Backend"
excerpt: "Development Information regarding LibrePhotos Backend."
last_modified_at: 2020-08-04
category: 5
---

The backend uses the following technologies:

- Python
- Django
- Pytorch

## ✨ Code Standards

In order to have a similar structure to the code, the backend repository has a pre-commit hook. Just use pre-commit install in the folder and then the linter and the formatter will check it before you commit your actual work.

We use black, flake8 and isort to keep our code tidy.

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

There are a lot of folders in our backend. Here is a quick rundown on where you can find what.

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

#### serializer

You have your python model and want to somehow convert that to JSON. That's what the serializer does!

### Machine Learning

We use as a base framework PyTorch. If you find a cool machine learning model with PyTorch, we sure can add that too.

#### im2txt

im2txt is an image captioning package which allows us to generate captions on demand. This sometimes creates useful output, but it is kind of old and there should be more recent models

#### Face Recognition

We use dlib and face_recognition to detect faces. A very cool feature would be the automatic clustering of unknown faces, which we have not implemented yet.

#### Tagging Models

The tags service (`service/tags/`) generates auto-tags for photos. Three models are available, selectable via the Tagging Model site setting:

- **places365** — Scene classification using the Places365 CNN. Generates scene category tags (e.g. "kitchen", "beach").
- **joytag** (`service/tags/joytag/`) — ONNX-based content tagger with 5000+ tags. Returns the top 15 tags sorted by sigmoid confidence.
- **siglip2** (`service/tags/siglip2/`) — Google's SigLIP 2 vision-language model running as ONNX. Uses zero-shot classification by computing cosine similarity between image embeddings and a curated vocabulary of 900+ text tag embeddings. Tag embeddings are cached to disk after the first run. Returns the top 10 tags.

Tags from each model are stored independently in `PhotoCaption.captions_json` under their model key (e.g. `"places365"`, `"joytag"`, `"siglip2"`), so switching models does not require regeneration.

#### Semantic Search

Here you can find the code which allows us to search semantically for images like "trees in a valley".
