---
title: "🔎 Search"
excerpt: "Find your photos using spotlight search, semantic search, and text search"
sidebar_position: 11
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
| `/` | Any platform |

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

- Photos, Albums, People, Places, Things, Events, Folders
- Favorites, Hidden, Videos, Recently Added, No Timestamp
- Sharing, Faces Dashboard, Statistics
- Settings, Profile, Library, Admin Area

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
- File paths
- Camera and lens information
- File type
- Time expressions (e.g. "January", "2024", "Thursday")

Results are displayed grouped by date, similar to the main timeline view.

## Semantic Search

Semantic search uses AI (CLIP embeddings) to find photos by meaning rather than exact text matching. Instead of matching keywords, it understands the concept behind your query.

For example, searching "sunset at the beach" will find photos that look like a sunset at a beach, even if none of those words appear in the photo's metadata or caption.

### Enabling Semantic Search

Semantic search is disabled by default because the first search takes a moment to build the similarity index.

1. Go to **Settings**
2. Find the **Semantic Search** setting
3. Set it to **Top 100**, **Top 50**, or **Top 10** (the number of results to return)

Once enabled, your text searches will use semantic matching. The first search may take up to a minute while the index is built; subsequent searches are fast.

:::tip
You need to have the **CLIP embedding** calculation job completed for semantic search to work. This runs automatically during photo scanning, or you can trigger it manually from the Library page.
:::

### How It Works

1. During scanning, LibrePhotos computes a CLIP embedding for each photo — a numerical representation of the image's visual content
2. When you search, your text query is also converted to a CLIP embedding
3. Photos whose embeddings are closest to your query embedding are returned as results
4. Results are ranked by similarity rather than grouped by date

## Similar Photos

When viewing a photo in the lightbox, the **Similar Photos** section in the sidebar shows visually similar photos from your library. These are found using the same CLIP embedding technology as semantic search.

Click on any similar photo to navigate directly to it. This is useful for:

- Finding photos from the same scene or event
- Discovering visually related content
- Spotting potential duplicates
