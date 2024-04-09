---
title: "💼 Job System"
excerpt: "A overview of what the worker logs mean"
sidebar_position: 5
---

## How does it work

The job system gives you information about the long-running jobs, including which job is running, in a queue, how far it progressed and when it started and stopped. At the moment, there are nine long-running jobs:

### Scan Photos

Scan photos will look at all media files in your scan directory and will add them to the library.

### Generate Auto Albums

This job will look at all media files that already exist. It tries to find common events by looking at the timestamp and grouping the images. If the media files are in a 1 day and 12 hour interval, they will appear in the same auto album.

### Generate Auto Albums Titles

This will create a title for the auto album based on the information of the media files in the auto album.

### Train Faces

This will look at all faces and its groups and will give us a certainty value for the image in the group.

### Delete Missing Photos

Finds all missing media files and removes them from the database.

### Calculate Clip Embedding

Calculates the CLIP value for all images. This is used for semantic search and for finding similar images.

### Scan Faces

Looks for faces in the images and save them to the database

### Cluster All Faces

Clusters the faces into known and unknown groups.

### Download Models

This downloads the needed machine learning models to data/protected_media/data_models/.

## Where to get information about previous run jobs

When you are logged in as an admin, click on the profile picture in the top right corner and then navigate to `Admin Area`. You should see the jobs at the bottom of the page in a table called `Worker Logs`

## What to do when a job gets stuck

When a job gets stuck, that usually means, that it crashed, and we could not catch the error correctly. You can just remove the entry from the list to start another job.
