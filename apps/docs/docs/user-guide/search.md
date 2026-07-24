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
- Favorites, Hidden, Videos, Trash, Recently Added, No Timestamp
- Sharing, Faces Dashboard, Statistics — and its sub-pages Place Tree, Word Clouds, Timeline, Social Graph and Face Clusters
- Settings, Profile, Library, Admin Area

Settings and Profile also expose keyword shortcuts: typing something like `password`, `language`, `clustering`, `metadata` or `llm` surfaces entries such as Change Password, Change Language, Face Recognition Settings, Metadata Settings and AI & LLM Settings, each of which opens the matching Settings or Profile page.

#### Actions

Trigger common actions directly from the spotlight:

- **Scan photos** / **Rescan photos** — Start a photo scan
- **Train faces** / **Rescan faces** — Run face recognition
- **Generate events** — Generate auto albums
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
- Date fragments in ISO form (e.g. `2024`, `2024-01`, `2024-01-15`) — the timestamp is matched as plain text, so month or weekday names such as "January" or "Thursday" do not match

Every word in your query must match, though not necessarily in the same field: searching `beach sunset` returns only photos where both `beach` and `sunset` appear somewhere in the indexed text (caption, person name, location, file path, camera, and so on). Commas separate words the same way spaces do. To search for an exact phrase, wrap it in quotes — `"golden gate bridge"` matches only photos containing that whole phrase.

The search results header also has an **All / Photos / Videos** toggle in the top right for narrowing the results to only photos or only videos.

Results are displayed grouped by date, similar to the main timeline view.

## Semantic Search

Semantic search uses AI (CLIP embeddings) to find photos by meaning rather than exact text matching. It understands the concept behind your query, and those matches are added to the normal text-search results rather than replacing them — so a search returns both the photos whose captions or metadata contain your words and the photos that simply look like what you described. Because of this, a result may not contain every word of your query.

For example, searching "sunset at the beach" will find photos that look like a sunset at a beach, even if none of those words appear in the photo's metadata or caption.

### Enabling Semantic Search

Semantic search is disabled by default. It works from CLIP embeddings, which LibrePhotos computes for your photos during a scan, plus an in-memory similarity index built from those embeddings.

1. Go to **Settings**
2. Find the **Semantic search max results** setting
3. Set it to **Top 100**, **Top 50**, or **Top 10** — the maximum number of semantically similar photos to add to your results. Matches that fall below an internal similarity threshold are dropped, so you may get fewer than this, and because keyword matches are still included the total number of results can be higher.

Turning the setting on also queues a background job that computes CLIP embeddings for any photos that do not have one yet and then builds the similarity index. Semantic results only start appearing once that job has finished, which can take a while on a large library that has never been embedded. The index itself lives in memory in the image-similarity service and is rebuilt automatically each time the backend container starts; the first query after a restart can take a moment while the CLIP model loads, after which queries are fast.

:::tip
You need to have the **CLIP embedding** calculation job completed for semantic search to work. This runs automatically during photo scanning, or you can trigger it manually from the Library page.
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
