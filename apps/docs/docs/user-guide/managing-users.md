---
title: "👨‍👩‍👧‍👦 Manage multiple user"
excerpt: "In this document I explain how to manage users"
sidebar_position: 2
---

### Manage User

Click on your Avatar → Admin Area to navigate to your user panel.

The user panel is at the bottom of the page above the worker logs.

You can create, delete and manage users of your instance. You can change the scan path, password, name and e-mail of a given user.

**Please note:**
In LibrePhotos, the file system acts as the definitive source of photo organization. This means that folder structure dictates how photos are grouped and accessed within the application.

To isolate users and their photo collections, create separate subfolders for each user on your host system (e.g., /data/user1, /data/user2, etc.). Then assign each user their respective subfolder as their scan directory in LibrePhotos. This ensures that users only see and interact with the photos in their designated directories.

If multiple users are assigned the same scan directory (e.g., /data), all photos within that directory will be accessible to all users. LibrePhotos treats the directory as a global source of photos, meaning that every user linked to the directory will see all its contents.

While the application saves metadata (e.g., tags, albums, facial recognition data) on a per-user basis in its database, it doesn’t inherently restrict access to the photos themselves. Access permissions must be managed through the file system / paths.

The separation will also not keep the photos "private" as the admin of the host system can see all the images.

## User Registration

Click on your Avatar → Admin Area to the user registration setting.

You can also activate user registration, where user can create an account themselves. They cannot change the path, which means the admin is still in full control.

## How to change the admin password, when you can't log in

There are two ways to accomplish that:

- 1. If you set the credentials of the admin in your environment variables, then the password should reset on a reboot
- 2. If you have access to your container, you can change the password by executing a Django management command `docker exec -it [backend container name] python manage.py changepassword [admin username]`
