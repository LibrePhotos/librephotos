---
title: "🔎 Search"
description: "Find your photos using spotlight search, semantic search, and text search"
sidebar_position: 3
---

LibrePhotos offers several ways to search through your photo library, from quick keyboard-driven navigation to AI-powered semantic search.

## Spotlight Search (Cmd+K)

The spotlight is a powerful command palette that gives you instant access to search, navigation, and actions — all from the keyboard.

### Opening the Spotlight

Press any of these keyboard shortcuts to open the spotlight:

| Shortcut | Platform |
|----------|----------|
| `Ctrl + K` | Windows / Linux |
| `Cmd + K` | macOS |
| `Ctrl + P` | Windows / Linux |
| `Cmd + P` | macOS |
| `/` | Any platform |

:::note
`Ctrl + P` / `Cmd + P` opens the spotlight rather than the browser's print dialog. Use the browser menu if you need to print the page.
:::

You can also click the search icon in the top menu bar.

### What You Can Do

The spotlight provides three types of actions:

#### Search

Start typing to search across your entire library:

- **People** — Search by person name
- **Places** — Search by location name
- **Things** — Search by detected objects or scene types
- **User albums** — Search your album names
- **Free text** — Search photo captions and metadata

Select "Search for [your query]" to perform a full search and see all matching results.

#### Navigation

Quickly jump to any page in LibrePhotos:

- Photos, Albums, My Albums, People, Places, Things, Tags, Events, Folders
- Favorites, Hidden, Videos, Trash, Recently Added, No Timestamp, No Location, Not in an Album
- Sharing, Faces Dashboard, Statistics — and its sub-pages Place Tree, Word Clouds, Timeline, Social Graph and Face Clusters
- Settings, Profile, Library, Admin Area

Settings and Profile also expose keyword shortcuts: typing something like `password`, `language`, `clustering`, `metadata` or `llm` surfaces entries such as Change Password, Change Language, Face Recognition Settings, Metadata Settings and Caption Context Settings, each of which opens the matching Settings or Profile page.

#### Actions

Trigger common actions directly from the spotlight:

- **Scan photos** / **Rescan photos** — Start a photo scan
- **Train faces** / **Rescan faces** — Run face recognition
- **Generate events** — Group photos into events
- **Delete missing photos** — Clean up missing files
- **Toggle theme** — Switch between light and dark mode

## Text Search

When you perform a search (either from the spotlight or the search bar), LibrePhotos searches across multiple fields:

- Photo captions (AI-generated and manual)
- People's names
- Location names (from reverse geocoding)
- Keywords and tags embedded in the photo (XMP `Subject` and IPTC `Keywords`, including from `.xmp` sidecar files) — for example, tags applied in Lightroom or digiKam
- File paths
- Camera and lens information
- File type
- Text recognised in the photo, when [text recognition](./text-recognition.md) is on and has read the photo (receipts, signs, screenshots)
- Date fragments in ISO form (e.g. `2024`, `2024-01`, `2024-01-15`) — the timestamp is matched as plain text, so month or weekday names such as "January" or "Thursday" do not match

Every word in your query must match, though not necessarily in the same field: searching `beach sunset` returns only photos where both `beach` and `sunset` appear somewhere in the indexed text (caption, person name, location, file path, camera, and so on). Commas separate words the same way spaces do. To search for an exact phrase, wrap it in quotes — `"golden gate bridge"` matches only photos containing that whole phrase.

Accents and letter case do not matter, in either direction: `Zurich` finds photos taken in Zürich, `café` finds a caption that says "cafe", and `Lodz` finds "Łódź". This covers everything in the list above except the date, plus your tags. Text found in photos by OCR is still matched as written. The spotlight's suggestions ignore accents the same way. (Not released yet: up to 1.3.0, a search had to spell every accent. The upgrade prepares existing photos once, while the database migrates.)

The search results header also has an **All / Photos / Videos** toggle in the top right for narrowing the results to only photos or only videos.

Results are displayed grouped by date, similar to the main timeline view.

## Search Filters

:::note Not released yet
The search API takes these filters in the release after 1.3.0. The web app's filter panel comes in a later update; until then they are for scripts and other apps that call the API.
:::

Besides the words you type, a search can be narrowed by what the camera recorded, the rating, the day, the location, the file and the people in the photo. The filters are query parameters of `GET /api/photos/searchlist/`. They combine with each other, with the search words and with the **All / Photos / Videos** toggle (every condition must hold), and they also work without any search words: `/api/photos/searchlist/?camera=X-T5&iso_min=3200` lists every photo taken with that camera at ISO 3200 or more.

| Parameter | Finds photos… |
|-----------|---------------|
| `camera` | taken with this camera model, for example `X-T5` (the whole name, any letter case) |
| `make` | taken with a camera from this maker, for example `FUJIFILM` |
| `lens` | taken with this lens model |
| `iso_min`, `iso_max` | with an ISO speed in this range |
| `aperture_min`, `aperture_max` | with an f-number in this range, for example `aperture_min=1.4&aperture_max=2` |
| `focal_min`, `focal_max` | with a focal length in this range, in millimetres |
| `focal35_min`, `focal35_max` | with a 35 mm equivalent focal length in this range |
| `rating_min` | rated at least this many stars (1 to 5) |
| `taken_after`, `taken_before` | taken on or after, or on or before, this day (`2024-03-01`) |
| `has_location` | with GPS coordinates (`true`) or without them (`false`, the same photos as the **No Location** page) |
| `file_type` | whose main file is an `image` or a `video`, or that have a RAW file (`raw`, the photos with the RAW badge) |
| `extension` | whose main file has this extension, for example `cr3` or `.heic` |
| `person` | showing this person. Repeat it for several people (`person=3&person=7`) to find the photos with all of them together |

Ranges include both ends, and either end can be left out. A photo without the value, for example one whose camera did not record the lens, never matches a filter on it. A value the server cannot read, a range whose lowest value is above its highest, an unknown file extension or someone else's person answers with an error that names the parameter, rather than with an empty result.

The camera maker comes from the photo's EXIF data since the release after 1.3.0. Photos scanned before that have none until you rescan them, so `make` does not find them yet.

`GET /api/search/metadata-values/?field=camera` lists the camera models of your photos with how many photos each one took, most used first. `field=make` lists the makers and `field=lens` the lenses. Pick a filter value from there to be sure it matches.

The bulk actions (favorite, hide, tag, share, add to an album, download, move to the trash) take the same parameters in their select-all `query`, so selecting every result of a filtered search acts on exactly the photos it listed. Send `show_all_stack_photos: true` with them, because search lists every photo of a stack, not only the one the timeline shows. The search words themselves are not part of a select-all.

## Semantic Search

Semantic search uses AI (CLIP embeddings) to find photos by meaning rather than exact text matching. It understands the concept behind your query, and those matches are added to the normal text-search results rather than replacing them — so a search returns both the photos whose captions or metadata contain your words and the photos that simply look like what you described. Because of this, a result may not contain every word of your query.

For example, searching "sunset at the beach" will find photos that look like a sunset at a beach, even if none of those words appear in the photo's metadata or caption.

### Enabling Semantic Search

Semantic search is disabled by default. It works from CLIP embeddings, which LibrePhotos computes for your photos during a scan, plus a similarity index built from those embeddings.

1. Go to **Settings**
2. Find the **Semantic search max results** setting
3. Set it to **Top 100**, **Top 50**, or **Top 10** — the maximum number of semantically similar photos to add to your results. Matches that fall below an internal similarity threshold are dropped, so you may get fewer than this, and because keyword matches are still included the total number of results can be higher.

Turning the setting on also queues a background job that computes CLIP embeddings for any photos that do not have one yet and then builds the similarity index. Semantic results only start appearing once that job has finished, which can take a while on a large library that has never been embedded. The image-similarity service keeps the index on disk under `protected_media/similarity/`, so it survives a restart of that service, and it is rebuilt automatically each time the backend container starts. The first query after a while without searches can take a moment while the CLIP model loads again, after which queries are fast.

:::tip
You need to have the **CLIP embedding** calculation job completed for semantic search to work. This runs automatically during photo scanning, or you can trigger it manually from the Library page.
:::

### Which model searches

One model turns photos and queries into embeddings and detects the things in your photos: [OpenCLIP](https://huggingface.co/laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K) ViT-B/32, trained by LAION on DataComp-XL and released under the MIT licence. Detecting a photo's things yields its search embedding from the same run, so a scan runs one vision model per photo. There is nothing to choose in the settings.

:::note Upgrading to 1.3.0
Releases up to 1.2.x searched with CLIP ViT-B/32 and detected things with another model. After the upgrade a **Calculate Clip Embeddings** job re-embeds every photo with OpenCLIP in the background and gives it new things from the same run; nothing is deleted first. While it runs, semantic search and similar photos cover the photos converted so far (the index catches up every 2,000 photos), and the Things albums fill up again as photos are processed again. It happens once.
:::

### How It Works

1. During scanning, LibrePhotos computes a CLIP embedding for each photo — a numerical representation of the image's visual content
2. When you search, your text query is also converted to a CLIP embedding
3. Photos whose embeddings are closest to your query embedding are returned as results
4. Matching photos are returned as a single flat list instead of being grouped by date. The list is not sorted by similarity score — the CLIP ranking only decides *which* photos come back (the top N you configured), not the order they appear in

## Similar Photos

When viewing a photo in the lightbox, the **Similar Photos** section in the sidebar shows visually similar photos from your library. These are found using the same CLIP embedding technology as semantic search.

Click on any similar photo to navigate directly to it. This is useful for:

- Finding photos from the same scene or event
- Discovering visually related content
- Spotting potential duplicates
