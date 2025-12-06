---
title: "✔️ First steps"
excerpt: "First steps after setting up"
sidebar_position: 1
---

## First Time Setup Wizard

When you first access LibrePhotos, you'll be greeted with a guided setup wizard that walks you through the initial configuration in three easy steps.

### Step 1: Create Your Admin Account

The first step is to create your administrator account. Fill in the following details:

- **Username** – Your login name (will be converted to lowercase)
- **Email** – Your email address
- **First Name** – Your first name
- **Last Name** – Your last name
- **Password** – Choose a secure password
- **Confirm Password** – Re-enter your password to confirm

Click **Sign Up** to create your account. You'll be automatically logged in and taken to the next step.

### Step 2: Site Settings

In this step, you can configure important site-wide settings:

- **Allow Upload** – Enable or disable the ability for users to upload photos directly to LibrePhotos
- **Allow Registration** – Enable or disable public user registration (new users can create their own accounts)

These settings can always be changed later in the Admin Area. Click **Continue** to proceed.

### Step 3: Configure Your Scan Directory

This is where you tell LibrePhotos where your photos are stored:

1. **Skip RAW Files** (optional) – Toggle this on if you want LibrePhotos to ignore RAW image files during scanning

2. **Scan Directory** – Select or type the path to your photos folder. If you haven't modified the default `docker-compose.yml`, this should be `/data`, which corresponds to the folder you configured as `scanDirectory` in your `.env` file.

   The directory picker shows a visual tree of available folders that you can click to select, or you can type the path directly.

3. Click **Save** to save your settings and start the initial photo scan, or click **Skip** if you want to configure this later.

Once complete, you'll be taken to the main LibrePhotos interface and your first scan will begin automatically if you configured a scan directory.

---

## After Setup

### Understanding Scan Directories

The basic idea is this:

- For scanning photos that reside in the local file system
  - Only the admin user can change the "scan directory" of the users, including that of the admin themselves.
  - Normal users cannot change their own "scan directory"
  - Only the admin can find the page to control this - under the user icon (top right) > `Admin Area`
- For scanning photos that reside in external Nextcloud instances
  - Any user can change their own Nextcloud endpoint, and choose a top level directory in the Nextcloud account.

### How to Change Your Scan Directory

Click on your avatar in the top right, and go to `Admin Area`. On this page, it will show a list of users. Manually set the `Scan Directory` for the desired user. Only an admin can do this.

### How to Start a Scan

Click on your avatar in the top right, and go to `Library`. Click the green `Scan photos (file system)` button. See the [auto scan page](./auto-scan.md) if you would like to set up automated scanning for new photos.

### How to Import Photos from an External Nextcloud Instance

If you have a Nextcloud instance, you can also input login details for it in the `Dashboard` > `Library` page.
Fill out the details for the Nextcloud section. Once logged in (the little circle next to `Nextcloud Scan Directory` will be green), you can choose a top level directory in your logged in Nextcloud account. Once this has been configured, you can click the blue `Scan photos (Nextcloud)` button. This will copy the contents of the specified Nextcloud directory ([excluding videos](https://github.com/LibrePhotos/librephotos/issues/278)) to the local filesystem.
