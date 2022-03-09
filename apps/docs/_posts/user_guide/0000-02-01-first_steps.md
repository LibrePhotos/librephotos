---
title: "✔️ First steps"
excerpt: "First steps after setting up"
last_modified_at: 2021-10-07
category: 2
---

## First steps after setting up

You need to log in as the admin user, and set up the directory for the users. To do this, click the top right button,
and go to `Admin Area`. On this page, it will show a list of users. Manually set the `Scan Directory` for the desired
user. Only an admin can do this. Then, go to `Dashboard` > `Library` and click the green `Scan photos (file system)`
button. If you have a Nextcloud instance, you can also input login details for it in the `Dashboard` > `Library` page.
Once logged in (the little circle next to `Nextcloud Scan Directory` will be green), you can choose a top level
directory in your logged in Nextcloud account. Once this has been configured, you can click the blue `Scan photos (Nextcloud)` button. This will copy the contents of the specified Nextcloud directory to the local filesystem.

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including that of the admin themselves.
  - Normal users cannot change their own "scan directory"
  - Only the admin can find the page to control this - under the user icon (top right) > `Admin Area`
- For scanning photos that reside in external Nextcloud instances
  - Any user can change their own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.

You can also enable automatic scanning of folders. You can read more [here]({% post_url user_guide/0000-02-02-auto_scan %}).
