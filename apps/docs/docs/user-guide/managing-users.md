---
title: "👨‍👩‍👧‍👦 Manage multiple user"
description: "In this document I explain how to manage users"
sidebar_position: 21
---

### Manage User

Click on your Avatar → Admin Area to navigate to your user panel.

The user panel is at the bottom of the page above the worker logs.

You can create, delete and manage users of your instance. You can change the scan path, password, name and e-mail of a given user.

**Please note:**
In LibrePhotos, the file system acts as the definitive source of photo organization. This means that folder structure dictates how photos are grouped and accessed within the application.

To isolate users and their photo collections, create a subfolder for each user inside the folder you set as `scanDirectory` in your `.env` file — the folder LibrePhotos mounts as `/data`. Inside LibrePhotos these show up as `/data/user1`, `/data/user2`, etc., and that is the path you assign as each user's scan directory. Create the folders before assigning them: LibrePhotos only accepts directories that already exist under `/data`. This ensures that users only see and interact with the photos in their designated directories.

If multiple users are assigned the same scan directory (e.g., /data), all photos within that directory will be accessible to all users. LibrePhotos treats the directory as a global source of photos, meaning that every user linked to the directory will see all its contents.

While the application saves metadata (e.g., tags, albums, facial recognition data) on a per-user basis in its database, it doesn’t inherently restrict access to the photos themselves. Access permissions must be managed through the file system / paths.

The separation will also not keep the photos "private" as the admin of the host system can see all the images.

## User Registration

Click on your Avatar → Admin Area to the user registration setting.

You can also activate user registration, where user can create an account themselves. They cannot change the path, which means the admin is still in full control.

A self-registered account is created without a scan directory, so the new user sees an empty library and is told to contact their administrator if they try to scan or upload. After someone signs up, open the Admin Area, edit their account in the user panel at the bottom of the page and set its scan path as described above.

## How to change the admin password, when you can't log in

There are three ways to accomplish that:

- 1. If your `.env` sets the admin credentials, the password is reset every time the backend container starts. The keys are `userName`, `userPass` and `adminEmail` (passed to the backend as `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL`), and both the username and password must be non-empty. They are not in the shipped `librephotos.env` template, so add them yourself — see [Admin account variables](../installation/environment-variables.md#admin-account-variables) for the full behaviour.
- 2. If you have access to your container, you can change the password by executing a Django management command `docker exec -it [backend container name] python manage.py changepassword [admin username]`
- 3. If outgoing e-mail is configured on your instance, the login page shows a **Forgot your password?** link that e-mails a reset link to the address on your account. This only works once e-mail is set up (Admin Area → Site settings → Email) and the account has an e-mail address, so arrange both *before* you get locked out. Behind the bundled proxy, also set `frontendBaseUrl` in your `.env` (passed to the backend as `FRONTEND_BASE_URL`) so the emailed link points at your public address rather than the internal one.
