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

We use black, flack8 and isort to keep our code tidy.

## 🐛 Debugging

Usually nothing goes as planned and you need to debug your shiny new feature. In the next paragraph I will explain you the two tools we have for debugging:

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

### Using slik

In order to debug queries, start the backend container in dev mode. Then you can access silk under /api/silk. Silk is a live profiling and inspection tool for the Django framework. Silk intercepts and stores HTTP requests and database queries before presenting them in a user interface for further inspection.

## 🏙️ Structure

There are alot of folders in our backend. Here is a quick rundown on where you can find what.

### Django

Most of the application code is within the api folder using django. In the following section I will explain where you can find what

#### management

This exposes all the commands that you can use via the command line. If you want a new command that's the place to add it.

#### migrations

Every time we change our models we have to migrate the database. We use djangos migration feature to create migration files to migrate without the headaches.

#### models

Here are the actual data types. If you want to figure out how a photo works or how faces are connected to persons, than this is your folder.

#### views

Here you can find our API implemented. They are seperated similar to the modlds. Views that expose the photos will be here in photos too.

#### serializer

You have you python model and want to somehow convert that to json. That's what the serializer does! There are two different types of serializers: Normal ones and serpy serializer. Serpy serilizer are faster and we sometimes need them if we need to serialize alot of data. The package is no longer maintained though and we are looking for a replacement or for refactoring to serialize less data at once.

We are currently in the process in splitting them up similar to how we did it in views.

### Machine Learning

We use as a base framework pytorch. If you find a cool machine learning model with pytorch, we sure can add that too.

#### im2txt

im2txt is a image captioning package which allows us to generate caption on demand. This creates sometimes useful output, but it is kind of old and there should be more recent models

#### Face Recognition

We use dlib and face_recognition to detect faces. A very cool feature would be the automatic clusterting of unknown faces, which we do not yet have.

#### places365

places365 generates scene classifications for a given image. It genereate the tags you see when you open the photo details in the UI.

#### Semantic Search

Here you can find the code which allows us to search semantically for images like "trees in a valley".
