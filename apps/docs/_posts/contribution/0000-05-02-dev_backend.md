---
title: "Backend"
excerpt: "Development Information regarding LibrePhotos Backend."
last_modified_at: 2020-08-04
category: 5
---
We developed our backend with the following technologies:
- Python
- Django
- Serpy

## Debugging the backend

The following works for debugging the backend:

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

## Structure
Most of the application code is within the api folder. In the following I will explain where you can find what.

## im2txt
im2txt is a image captioning package which allows us to generate caption on demand.

## management
This exposes all the commands that you can use via the command line.

## migrations
Every time we change our models we have to migrate the database. We use djangos migration feature to create migration files to migrate without the headaches.

## models
Here are the actual data types. If you want to figure out how a photo works or how faces are connected to persons, than this is your folder.

## places365
places365 generates scene classifications for a given image. It genereate the tags you see when you open the photo details in the UI.

## semantic_search
Here you can find the code which allows us to search semantically for images like "trees in a valley".

## views
Here you can find our API implemented. This will get split up further as time goes on.

All the other classes you see, don't fit into the folder structure for now.

