---
title: "🔤 Text Recognition (OCR)"
description: "Make the text on your photos searchable, select it in the photo viewer, and what turning it on means for privacy."
sidebar_position: 9.5
---

## What is text recognition?

Text recognition (OCR, optical character recognition) reads the text it can find on your photos: receipts, letters, signs, screenshots, whiteboards, book pages. LibrePhotos stores that text with the photo, so you can [search for it](#searching-for-text) and [select and copy it](#selecting-text-in-the-photo-viewer) in the photo viewer. It also helps LibrePhotos tell [documents](#documents) apart from ordinary photos.

Text recognition is off on a new install. An administrator turns it on for the whole server, and then each user starts it for their own photos.

## Privacy: what turning it on means {#privacy}

When an administrator picks a model, LibrePhotos asks them to confirm, under the heading **Text recognition reads everything**:

> Text recognition stores all readable text of every photo in the database as plain text. That includes documents, receipts, letters and IDs that happen to be in your library. Larger models are more accurate, but need more time and memory per photo.

Some things to know before you turn it on:

- The text stays on your server. The model runs locally, like every other model in LibrePhotos.
- The text is not encrypted. Anyone who can read your database or a database backup can read it.
- Only the owner of a photo sees its text. People you share a photo or an album with, and visitors of a public link, do not get it, and search only ever looks at your own photos.
- Turning it off again does not delete the text that was already read. See [Turning it off again](#turning-it-off).

## Turning it on {#enabling}

An administrator turns text recognition on in **Account menu > Admin Area**, under **Site settings**, with **Text Recognition (OCR) Model**:

| Model | Download | When to pick it |
| --- | --- | --- |
| **None** | | Text recognition is off. This is the default. |
| **PP-OCRv6 Tiny** (fastest) | about 6 MB | Older or low-power machines, or when speed matters more than every word. |
| **PP-OCRv6 Small** | about 26 MB | A balance between speed and accuracy. |
| **PP-OCRv6 Medium** (most accurate) | about 100 MB | Small print and difficult photos, when the machine has memory and time to spare. |

Picking a model opens the confirmation described [above](#privacy). **Cancel** keeps the previous choice. After you click **Save**:

- A **Download Models** job fetches the model if it is not on the server yet.
- The `ocr` service starts within about a minute, with no restart. You can see it under **Services** in the Admin Area (see [Service Management](./library.md#service-management)).

Nothing is read yet at this point. Each user starts the reading from their Library page, as described next.

## Extracting text from your photos {#extracting-text}

Open **Account menu > Library**. Under the **Text Recognition** heading is the **Extract Text** row:

- **Extract** reads the photos that have not been read yet. The first time, that is all of your photos. After that, it reads the photos added since the last run.
- The arrow next to **Extract** opens **Extract text again for all photos**, which reads every photo again, also the ones that already have text.

Both start an **Extract Text (OCR)** job, which you can follow under **Account menu > My Jobs**. It reads photos only, not videos. Each user runs it for their own photos, so on a shared server every user clicks **Extract** for themselves.

The job does not run by itself after a scan. When you have added new photos, click **Extract** again to read them.

If the administrator changes the model later, **Extract** also reads again the photos that were read with the previous model.

When no model is selected, the buttons are disabled. Administrators then see "Choose a text recognition model in the admin area to enable this.", and other users see "Text recognition is turned off on this server. Ask your administrator to choose a text recognition model."

## Searching for text {#searching-for-text}

Once a photo's text has been read, a normal search also looks at that text. Searching `invoice` or `Main Street` finds the receipt or the street sign that shows those words, together with the photos that match by caption, place, person and so on. See [Text Search](./search.md#text-search).

On PostgreSQL (the Docker setups) the text is matched word by word. On SQLite (the Windows app and the single container's internal database) any photo whose text contains your search term matches, also in the middle of a word.

## Selecting text in the photo viewer {#selecting-text-in-the-photo-viewer}

When LibrePhotos found text on one of your photos, the photo viewer shows an extra toolbar button, **Select text in photo (T)**. Click it, or press `t`, and the recognised text is laid over the photo, so you can select it with the mouse and copy it like text on a web page. Press `t` again, or click **Stop selecting text (T)**, to go back to the plain photo.

The button only appears on your own photos, and only when text was found on them.

## Documents {#documents}

LibrePhotos uses the recognised text, together with the things it sees in the photo (the same labels as the **Things** albums), to find documents: receipts, letters, forms and book pages. A photo is marked as a **Document** when it shows a thing such as a receipt, an invoice or a book page, or when two hints come together, for example a lot of text, an amount next to a word like "total", or a thing such as a menu or a whiteboard. The **Extract Text (OCR)** job checks this for every photo it reads. You can then hide documents from the timeline with the **Filter** button (see [Filtering the timeline](./viewing-photos.md#filtering-the-timeline)), browse them on the **Documents** page, or pick **Documents only** with the [media button](./viewing-photos.md#media-filter) of a list such as Favorites or an album (both not in a release yet; they ship with the first release after 1.3.0).

Without text recognition, LibrePhotos has nothing to go on and no photo is detected as a document. You can still mark photos as documents yourself, see [Category](./viewing-photos.md#category).

## Turning it off again {#turning-it-off}

Set **Text Recognition (OCR) Model** back to **None**. The `ocr` service stops being started within about a minute, and **Extract** is disabled for everyone.

This only stops reading new text. **The text that was already read stays in the database, and search keeps finding it.** If you turned text recognition off for privacy reasons, keep this in mind. LibrePhotos has no button to delete the stored text yet.

For the other switches that live in Site Settings rather than in environment variables, see [Feature Toggles](./feature-toggles.md#switches-in-site-settings).
