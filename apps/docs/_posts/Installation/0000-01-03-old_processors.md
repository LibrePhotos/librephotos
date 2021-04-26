---
title: "Docker Compose - Processors without AVX instructions"
excerpt: "How to build the backend yourself to support old processors"
last_modified_at: 2021-04-26
category: 1
---

### The error

AVX is a ten year old instruction set that is used for machine learning applications.

If you use an old processor or an processor that doesn't support AVX instruction sets, you will get the error message in the frontend "Backend is not connected". The logs will show worker who continuously reboot.

### Solution 1: Docker Image from a community member

To resolve this issue you can either download an backend image from another community member:
Change the following line in your docker-compose.yml file.

 ~~~diff
backend:
-    image: reallibrephotos/librephotos:${tag}
+    image: delian2/librephotos:${tag}
     restart: always
     volumes:
       - ${myPhotos}:/data
 ~~~

### Solution 2: Building the docker image yourself

Clone the repo: <code> git clone git@github.com:LibrePhotos/librephotos-docker.git </code>

Open the terminal, go to `.\backend` and build the image with: 

`docker build . -t reallibrephotos/librephotos:dev`
