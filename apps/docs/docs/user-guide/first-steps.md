---
title: "First steps"
description: "First steps after setting up"
sidebar_position: 1
---

## First Time Setup Wizard

When you first access LibrePhotos, you'll be greeted with a guided setup wizard that walks you through the initial configuration in four steps: **Account**, **Settings**, **Errors** and **Library**.

### Step 1: Create Your Admin Account

The first step is to create your administrator account. Fill in the following details:

- **Username** – Your login name (will be converted to lowercase)
- **Email** – Your email address
- **First name** – Your first name
- **Last name** – Your last name
- **Password** – Choose a secure password
- **Confirm password** – Re-enter your password to confirm

Click **Create admin account** to create your account. You'll be automatically logged in and taken to the next step.

### Step 2: Site Settings

In this step, you can configure important site-wide settings:

- **Allow uploads** – Enable or disable the ability for users to upload photos directly to LibrePhotos
- **Allow user registration** – Enable or disable public user registration (new users can create their own accounts)

These settings can always be changed later in the Admin area. Click **Continue** to proceed.

### Step 3: Error reports

<Since version="1.6.0" /> Choose whether error reports are shared with the LibrePhotos maintainers. Nothing is sent unless you turn it on; see [Error reporting](./error-reporting.md).

### Step 4: Configure Your Scan Directory

This is where you tell LibrePhotos where your photos are stored:

1. **Scan directory** – Select or type the path to your photos folder. If you haven't modified the default `docker-compose.yml`, your photos are under `/data`, which corresponds to the folder you configured as `scanDirectory` in your `.env` file.

   If you will be the only user, `/data` itself is fine. If you plan to add more users later, pick a subfolder for yourself instead, for example `/data/admin` (create it on the host first). Scan directories of different users cannot overlap, so once your account scans `/data` itself, no other user can be given a folder under it. See [Managing users](./managing-users.md).

   The directory picker shows a visual tree of available folders that you can click to select, or you can type the path directly.

2. Click **Save** to save your settings and start the initial photo scan, or click **Skip** if you want to configure this later.

Once complete, you'll be taken to the main LibrePhotos interface and your first scan will begin automatically if you configured a scan directory.

If you shoot RAW+JPEG, the scan keeps the two files of a shot together as one photo with a RAW variant when they are in the same folder and have the same name. See [Stacks & file variants](./stacks-and-file-variants.md#rawjpeg-pairs).

---

## After Setup

### Understanding Scan Directories

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including that of the admin themselves.
  - Normal users cannot change their own "scan directory"
  - Each user needs a scan directory of their own: it cannot be the same as, inside, or above another user's scan directory. To show the same photos to several users, [share them](./sharing.md) instead.
  - Only the admin can find the page to control this: **Account menu > Admin area**
- For scanning photos that reside in external Nextcloud instances
  - Any user can change their own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.

### Staying Signed In
<Since version="1.5.0" />

The login page has a **Remember me** checkbox under the password. Leave it off and you are signed out when you close the browser, or after 7 days at the latest. Tick it and this browser keeps you signed in for 30 days, also after a restart; when you tick it, the page says for how many days. Only tick it on your own device, not on a shared computer.

- **Log out** (in the menu under your avatar) ends a remembered sign-in on that browser right away.
- A remembered sign-in does not get longer by using it: after the 30 days you sign in again.
- Some browsers restore your last session when they start, and keep you signed in even without **Remember me**. That is a browser setting.
- Single sign-on (the buttons under "or") always works like a sign-in without **Remember me**.
- An admin can change both lifetimes, or remove the checkbox, with `REFRESH_TOKEN_DAYS` and `REMEMBER_ME_DAYS` (see [Sign-in sessions](../installation/environment-variables.md#sign-in-sessions)).

### How to Change Your Scan Directory

Open **Account menu > Admin area**. On this page, it will show a list of users. Manually set the `Scan directory` for the desired user. Only an admin can do this.

### How to Start a Scan

Open **Account menu > Library**. Under **Scan library**, click the **Scan** button. The chevron next to it opens a menu with **Rescan**, which reprocesses your entire library. See the [auto scan page](./auto-scan.md) if you would like to set up automated scanning for new photos. For more details on the Library page and all available actions, see [Library Management](./library.md).

### How to Import Photos from an External Nextcloud Instance

If you have a Nextcloud instance, you can also input login details for it on the `Library` page (**Account menu > Library**).
The Nextcloud section is hidden until an admin enables it in `Admin area` > `Site settings` > `Enable Nextcloud integration` (see [Library Management](./library.md#enabling-the-integration)).
Fill out the server address, username and app password for the Nextcloud section. Once the connection succeeds, the **Status** badge at the top of the Nextcloud section turns green and reads *Connected*. You can then click **Browse** next to **Nextcloud scan directory** to pick a top level directory in your Nextcloud account. Once this has been configured, you can click the blue **Scan** button at the bottom of the Nextcloud section (the one with the Nextcloud icon). This will copy the contents of the specified Nextcloud directory — images, videos, RAW files and XMP sidecars — to the local filesystem, and then index them the same way a regular file system scan does.

### How to Change Your Avatar

Open **Account menu > Profile**. Click **Change photo** next to your picture and choose **Upload image** to pick a file from your computer, or **Choose from a face** to start from the cover face of one of your people. A face you pick shows in the editor like a file would, so you can still move and zoom it. Click **Upload** to save it.

<Since version="1.4.0" /> Up to 1.3.0, an avatar could only come from a file on your computer.
