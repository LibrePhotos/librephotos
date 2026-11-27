---
title: "Search"
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

You can also click the search field at the top of the page (**Search photos, people and places**; on a phone it just says **Search**).

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

- Photos, Albums, My albums, People, Places, Things, Tags, Events, Folders
- Memories, Favorites, Hidden, Archive, Videos, Screenshots, Documents, Trash, Recently added, Photos without timestamps, Photos without location, photos not in an album
- <Since version="1.4.0" /> Filter photos: the search page with [filters](#search-filters) and no words
- Sharing, Review faces (the face dashboard), Statistics, and its sub-pages Place tree, Word clouds, Timeline, Social graph and Face clusters
- Settings, Profile, Library, Admin area

Settings and Profile also expose keyword shortcuts: typing something like `password`, `language`, `clustering`, `metadata` or `llm` surfaces entries such as Change password, Change language, Face recognition settings, Metadata settings and Caption context settings, each of which opens the matching Settings or Profile page.

#### Actions

Trigger common actions directly from the spotlight:

- **Scan photos** / **Rescan all photos** — Start a photo scan
- **Train face recognition** / **Detect faces in photos** — Run face recognition
- **Generate event albums** — Group photos into events
- **Remove missing photos** — Clean up missing files
- **Toggle dark mode** — Switch between light and dark mode

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

Accents and letter case do not matter, in either direction: `Zurich` finds photos taken in Zürich, `café` finds a caption that says "cafe", and `Lodz` finds "Łódź". This covers everything in the list above except the date, plus your tags. Text found in photos by OCR is still matched as written. The spotlight's suggestions ignore accents the same way. <Since version="1.4.0" /> Up to 1.3.0, a search had to spell every accent. The upgrade prepares existing photos once, while the database migrates.

The search results header also has a media button in the top right for narrowing the results to photos, videos, screenshots or documents, and a **Filters** button for everything else (see [Search Filters](#search-filters)).

With [semantic search](#semantic-search) on (the default), the results are one list with the best matches first; with it off, they are grouped by date, similar to the main timeline view.

<Since version="1.7.0" /> The header's **Sort** button picks the order of the results: **Best match**, **Newest first**, **Oldest first**, **Largest files first** or **Smallest files first**. With semantic search on, a search with words starts on **Best match**; otherwise the results follow your [photo order](./viewing-photos.md#photo-order). A sort you pick is remembered in this browser, and **Reset to default** goes back. Since the Sort button decides, the view options of the results have no **Order**.

The two size orders list the matches by file size as one flat list instead of grouping them by day, a way to find what takes the most space. They need a search term or a filter: on the search page without either, the Explore page stays. In a size order each tile shows the file's size (a file whose size is not known yet shows none and comes last), and at most the 1,000 largest or smallest matches are listed; when there are more, the count under the title says so, for example *4,250 photos · 1,000 largest shown*. The same sort is on the [Videos page](./viewing-photos.md#videos-only).

In the API the order is the `sort` parameter of `GET /api/photos/searchlist/`. The default, `relevance`, lists the best matches first with semantic search on and the newest first with it off; `sort=newest` and `sort=oldest` order the same matches by date (grouped by day with semantic search off). `sort=largest` and `sort=smallest` answer a flat `results` list of at most 1,000 photos, whatever the semantic search setting, with `count`, the number of all matches.

## Search Filters

:::note
<Since version="1.4.0" /> The filters come to the web app and to the API in the same release.
:::

Besides the words you type, a search can be narrowed by the people in the photo, the camera, the exposure, the rating, the day, the location and the file. On the search results page, click **Filters** next to the media button (on a phone, the filter icon) to open the panel:

- **People**: pick one or more people. With several, you get the photos with all of them together. While you type a name, the matching people are listed with the most faces first. <Since version="1.5.0" /> Up to 1.4.0, matches stayed in name order.
- **Camera**: the maker, the camera and the lens. The lists show the cameras of your own photos, most used first, with how many photos of your library each one took.
- **Exposure**: ISO, aperture, focal length, 35 mm equivalent focal length and <Since version="1.7.0" /> shutter speed, each as a lowest and a highest value (either can stay empty). A value applies when you leave the field or press Enter. Type a shutter speed as the camera shows it, `1/250` or `2 s` (or `0.5` seconds); the lowest is the fastest. Shortcuts set common ISO, focal length and shutter speed bands in one click; the shutter speed ones are *1/500 s or faster*, *1/500–1/60 s*, *1/60–1 s* and *1 s or longer*.
- **Rating**: with star ratings, the fewest stars a photo needs. With the favorite toggle (see the rating style in Settings), one **Favorites only** switch.
- **Taken**: on or after and on or before a day, or **This year**, **Last year** and **Last 12 months**.
- **Location**: only photos with GPS coordinates, or only those without.
- **File**: **Has a RAW file** (also finds RAW files paired with a JPEG) and the main file's extension, for example `cr3`. Photos or videos only stays on the media button.

Every change applies at once. The active filters show as chips under the title: the cross on a chip removes that filter, and **Clear all** removes every filter but keeps your words and the media type. The filters are part of the page address, so you can bookmark or share a filtered search, and Back undoes the last change.

To filter without any words, open the spotlight and choose **Filter photos**, or go to `/search/`. If a filter cannot be applied, for example a person deleted in the meantime, the page says so and offers to clear the filters.

Selecting all results and then acting on them (favorite, hide, tag, share, add to an album, download, move to the trash) acts on exactly the photos the search listed.

### Filters in the API

The filters are query parameters of `GET /api/photos/searchlist/`. They combine with each other, with the search words and with the media filter (every condition must hold), and they also work without any search words: `/api/photos/searchlist/?camera=X-T5&iso_min=3200` lists every photo taken with that camera at ISO 3200 or more.

| Parameter | Finds photos… |
|-----------|---------------|
| `camera` | taken with this camera model, for example `X-T5` (the whole name, any letter case) |
| `make` | taken with a camera from this maker, for example `FUJIFILM` |
| `lens` | taken with this lens model |
| `iso_min`, `iso_max` | with an ISO speed in this range |
| `aperture_min`, `aperture_max` | with an f-number in this range, for example `aperture_min=1.4&aperture_max=2` |
| `focal_min`, `focal_max` | with a focal length in this range, in millimetres |
| `focal35_min`, `focal35_max` | with a 35 mm equivalent focal length in this range |
| <Since version="1.7.0" /> `shutter_min`, `shutter_max` | with an exposure time in this range, in seconds: `shutter_min=0.004&shutter_max=0.008` finds 1/250 s to 1/125 s. A bound matches the camera's own value however it was rounded, so `shutter_max=0.016666666666666666` (1/60) also finds a stored `0.0166666666666667` |
| `rating_min` | rated at least this many stars (1 to 5) |
| `taken_after`, `taken_before` | taken on or after, or on or before, this day (`2024-03-01`) |
| `has_location` | with GPS coordinates (`true`) or without them (`false`, the same photos as the **No Location** page) |
| `file_type` | whose main file is an `image` or a `video`, or that have a RAW file (`raw`, the photos with the RAW badge) |
| `extension` | whose main file has this extension, for example `cr3` or `.heic` |
| `person` | showing this person. Repeat it for several people (`person=3&person=7`) to find the photos with all of them together |

Ranges include both ends, and either end can be left out. A photo without the value, for example one whose camera did not record the lens, never matches a filter on it. A value the server cannot read, a range whose lowest value is above its highest, an unknown file extension or someone else's person answers with an error that names the parameter, rather than with an empty result.

The camera maker comes from the photo's EXIF data since the release after 1.3.0. Photos scanned before that have none until you rescan them, so `make` does not find them yet.

`GET /api/search/metadata-values/?field=camera` lists the camera models of your photos with how many photos each one took, most used first. `field=make` lists the makers and `field=lens` the lenses. Pick a filter value from there to be sure it matches.

The bulk actions take the same parameters in their select-all `query`. Send `show_all_stack_photos: true` with them, because search lists every photo of a stack, not only the one the timeline shows. The search words themselves are not part of a select-all, so after a search with words the web app sends the listed photos instead.

## Semantic Search

Semantic search uses AI (CLIP embeddings) to find photos by meaning rather than exact text matching. It understands the concept behind your query, and those matches are added to the normal text-search results rather than replacing them — so a search returns both the photos whose captions or metadata contain your words and the photos that simply look like what you described. Because of this, a result may not contain every word of your query.

For example, searching "sunset at the beach" will find photos that look like a sunset at a beach, even if none of those words appear in the photo's metadata or caption.

### How results are ranked

<Since version="1.7.0" /> With semantic search on, a search reads your words in three steps:

1. **Dates, people and places become filters.** A year (`2022`), a month or season with or without a year (`October 2026`, `summer 2022`, `Dezember 2020`), *this year* or *last year*, the name of a person you named, and the name of one of your [places](./places.md) or of a place a photo was geocoded to (`Berlin`, `Provence`, `Zurich`) narrow the results to those photos. `sea in France` searches for *sea* among the photos taken in France; `Halloween 2022` for *Halloween* among the photos of 2022. A query that is only a date, a person or a place lists those photos, newest first. Since many photos have no location (most cameras record none), the photos of a place come first and the same search without the place follows, so `beach in Tenerife` still finds the beach photos of a camera without GPS further down.
2. **The rest is matched as words.** Each word must appear as a whole word (a plural counts: `dogs` finds *dog*), and where it appears decides its weight: a person's name counts most, then the place, the things and your tags, the captions, the text in the photo, and last everything else, such as the file path. So `car` no longer finds a folder called *cards*, and a photo of *Berlin* ranks above one whose path contains it.
3. **The rest is also matched by meaning**, by the CLIP model. Words in another language are looked up in the translated names of the things LibrePhotos detects (the same translations the Things page shows), so `Strand`, `plage` or `spiaggia` search for *beach*. The original word still matches captions and text in that language.

Both lists are merged by rank (reciprocal rank fusion): a photo high on both comes first, and a photo found only one way still shows up. Matches by meaning whose similarity to the query is very low are left out.

### Enabling Semantic Search

<Since version="1.7.0" /> Semantic search is on by default, at **Top 100**, and the update turns it on for every user who had it off. Up to 1.6.0 it was off by default and its matches came back in no particular order.

It works from CLIP embeddings, which LibrePhotos computes for your photos during a scan, plus a similarity index built from those embeddings. To change it:

1. Go to **Settings**
2. Find the **Semantic search max results** setting
3. Pick **Top 100**, **Top 50**, or **Top 10** — the most matches by meaning a search adds — or **Off** to search by words only, with the results grouped by date.

Turning the setting on also queues a background job that computes CLIP embeddings for any photos that do not have one yet and then builds the similarity index. Semantic results only start appearing once that job has finished, which can take a while on a large library that has never been embedded. The image-similarity service keeps the index on disk under `protected_media/similarity/`, so it survives a restart of that service, and it is rebuilt automatically each time the backend container starts. The first query after a while without searches can take a moment while the CLIP model loads again, after which queries are fast.

:::tip
You need to have the **CLIP embedding** calculation job completed for semantic search to work. This runs automatically during photo scanning, or you can trigger it manually from the Library page.
:::

### Which model searches

One model turns photos and queries into embeddings and detects the things in your photos: [OpenCLIP](https://huggingface.co/laion/CLIP-ViT-B-32-DataComp.XL-s13B-b90K) ViT-B/32, trained by LAION on DataComp-XL and released under the MIT licence. Detecting a photo's things yields its search embedding from the same run, so a scan runs one vision model per photo. There is nothing to choose in the settings.

:::note Upgrading to 1.3.0
Releases up to 1.2.x searched with CLIP ViT-B/32 and detected things with another model. After the upgrade a **Calculate CLIP embeddings** job re-embeds every photo with OpenCLIP in the background and gives it new things from the same run; nothing is deleted first. While it runs, semantic search and similar photos cover the photos converted so far (the index catches up after the first 2,000 photos and then each time the number converted has doubled, so a large library is not held up rebuilding it; up to 1.4.0 it caught up every 2,000 photos), and the Things albums fill up again as photos are processed again. It happens once.
:::

### How It Works

1. During scanning, LibrePhotos computes a CLIP embedding for each photo — a numerical representation of the image's visual content
2. When you search, the words left after the dates, people and places (in English, see above) are converted to a CLIP embedding
3. The image-similarity service ranks your photos by cosine similarity to it, best first (`POST /search/` with `"metric": "cosine"` and `"with_scores": true` answers the scores too; the default `ip` metric, the raw inner product, still serves Similar photos)
4. That ranking is merged with the word matches as described in [How results are ranked](#how-results-are-ranked), and the merged list is returned best match first

## Similar Photos

When viewing a photo in the lightbox, the **Similar photos** section in the sidebar shows visually similar photos from your library. These are found using the same CLIP embedding technology as semantic search.

Click on any similar photo to navigate directly to it. This is useful for:

- Finding photos from the same scene or event
- Discovering visually related content
- Spotting potential duplicates
