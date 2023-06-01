---
title: "👨‍👩‍👧‍👦 Manage multiple user"
excerpt: "In this document I explain how to manage users"
sidebar_position: 2
---

### Manage User

Click on your Avatar → Admin Area to navigate to your user panel.

The user panel is at the bottom of the page above the worker logs.

You can create, delete and manage users of your instance. You can change the scan path, password, name and e-mail of a given user.

## User Registration

Click on your Avatar → Admin Area to the user registration setting.

You can also activate user registration, where user can create an account themselves. They cannot change the path, which means the admin is still in full control.

## How to change the admin password, when you can't log in

There are two ways to accomplish that:

- 1. If you set the credentials of the admin in your environment variables, then the password should reset on a reboot
- 2. If you have access to your container, you can change the password by executing a Django management command `docker exec -it [backend container name] python manage.py changepassword [admin username]`
