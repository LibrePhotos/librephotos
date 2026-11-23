---
title: "Statistics and data visualization"
description: "Explore your photo library through interactive visualizations"
sidebar_position: 10
---

LibrePhotos includes a **Statistics** section with several interactive visualizations that help you explore patterns in your photo library. It is not in the sidebar: open it with **View statistics** at the top right of the **Library** page (**Account menu > Library**), or press `Ctrl+K` (`Cmd+K` on macOS) and search for "Statistics". You can also go straight to `/statistics`. The page starts with the same counts as the Library page, then a tab bar to switch between the six views: **Timeline** (where it opens), **Cameras**, **Place tree**, **Word clouds**, **Social graph** and **Face clusters**.

## Place Tree

The Place Tree shows all your photo locations organized in a hierarchical tree — from countries down to regions and cities. This gives you a bird's-eye view of everywhere you've taken photos.

- **Multiple layouts** — Switch between the tree layout (shown horizontally or vertically) and a radial layout
- **Link style** — Switch the connectors between curved, step and straight lines
- **Expand / collapse** — Click on any node to expand or collapse its children
- **Pan** — Drag anywhere on the canvas to move around the tree
- **Zoom** — Scroll to zoom, or use the zoom in / out / reset buttons; the keyboard shortcuts `+`, `-` and `0` (reset) also work
- **Hover** — Hover over a node to see its full name and photo count

## Timeline

The Timeline view provides three charts that show how your photo-taking habits have changed over time:

### Photo Count per Month

A bar chart showing how many photos you took each month. This makes it easy to spot busy months (vacations, events) vs. quieter periods.

### Photos per day

<Since version="1.7.0" />

A calendar heatmap like a contribution graph: every column is a week and every cell a day, and the deeper the colour the more photos you took that day. It shows one calendar year at a time, from January to December; in the current year the days after today are empty cells, so every year is as wide, and on a wide screen the year fills the page. The year picker next to the title lists every year you have dated photos in, including years before 2000, and starts on the latest one. The five shades are relative to the year shown: the busiest day of the year always gets the deepest shade, so a quiet year, even one with a single photo, still stands out. Without any dated photos, the section says *No dated photos yet*.

Only the photos you see in your library count: hidden photos, photos in the trash and photos without a date are left out, so clicking a day always opens the photos it counts.

Hover or focus a cell to see the date and its count, and click a day (or press `Enter` on it) to open that day's photos in the search view. With the keyboard, the left and right arrow keys move by a week, up and down by a day, and `Home` and `End` jump to the first and the last day. On a narrow screen the cells keep a size you can tap and the year scrolls sideways, starting at its latest week, while the weekday names stay in place on the left.

### Location Duration

A single horizontal stacked bar spanning your whole library, laid out chronologically. Each colored segment is one continuous stay at a location, and the segment's **width** shows how long that stay lasted. Hover over a segment to see the location name and the month-and-year range it covers; the color legend underneath lists every segment. Note that each stay gets its own color, so a place you visited more than once appears more than once. This is great for seeing travel patterns at a glance.

## Cameras

<Since version="1.7.0" />

The Cameras view shows which cameras and lenses took your photos, and the spread of your exposure settings. Spotlight (`Ctrl+K`) finds it as "Cameras".

- **Cameras** and **Lenses**: the camera and lens models your photos were taken with, most photos first, with the twelve most used shown until you click **Show all** (with the number of models, and **Show fewer** to fold them again). Names that differ only in letter case count as one, as the search matches them. A camera is counted with its maker, so the same model name from two makers is listed twice. When some photos of a model carry no maker (photos scanned before 1.4.0 have none until you rescan them), the model is listed once with all its photos.
- **Exposure charts**: one bar chart each for ISO, aperture, focal length, 35 mm equivalent focal length and shutter speed. Close values share a bar, so a phone's ISO 51 and 64 or its 1/121 s and 1/125 s do not each get their own: ISO and aperture in third stops (ISO 100, 125, 160, f/1.8, f/2, f/2.2), shutter speeds in whole stops (1/250, 1/125, 1/60), and focal lengths in bands of millimetres (24–28 mm, 28–35 mm).

Every row and every bar opens the search its count comes from. A camera row searches for that model, and its maker when every photo of the model names one. A bar searches for the range of its own photos, from the lowest to the highest value they carry, so the search finds exactly the photos the bar counts. On a phone, the first tap on a bar shows its count and a second tap on the same bar opens the search.

`GET /api/camera-stats/` answers the same lists for your own photos (not hidden, trashed or missing ones). Each camera and lens has a `label`, the `value` to search for and its `count`, a camera also the `make` to search with (empty when the row counts the model with any maker). Each exposure bar has a `label`, its `count`, and the `min` and `max` value of its photos, ready for the `iso_min`/`iso_max`, `aperture_min`/`aperture_max`, `focal_min`/`focal_max`, `focal35_min`/`focal35_max` and `shutter_min`/`shutter_max` search filters (shutter speeds in seconds).

## Word Clouds

Three interactive word clouds generated from your photo library:

| Cloud | Based on |
|-------|----------|
| **Places** | Place names from reverse geocoding (postcodes and points of interest are skipped) |
| **Things** | What OpenCLIP detected in your photos. These are also what populate your Things albums. |
| **People** | Names of recognized people in your photos |

Each cloud shows at most the top 100 terms, and larger words appear more frequently in your library. **Click on any word** to search for photos matching that term.

## Social Graph

A force-directed graph showing the relationships between people in your photos. Each node represents a person, and edges connect people who appear together in the same photos.

- **Nodes** are all drawn the same size and labeled with the person's name; a node's outline turns orange when you hover over it
- **Edges** connect people who appear together in at least one photo — the graph is unweighted, so every node and edge is drawn the same size
- **Drag** nodes to rearrange the layout
- **Zoom** to explore dense areas of the graph

This is a fun way to see who shows up in photos together.

## Face Clusters

A scatter plot of every detected face in your library. Each dot is one face, positioned by a projection of its face embedding, so faces that look alike land close together — this gives you an overview of how well face recognition has separated people.

- **Color** identifies the person; unlabeled faces are drawn as small gray dots
- **Hover** over a dot to preview the face thumbnail and the person's name
- **Click** a dot to open that photo in the lightbox
- **Filter by person** — Click a name badge above the plot to highlight that person's faces and dim everyone else's. The badges list the people with the most detected faces, plus **All** to clear the filter and **Unknown** for faces not yet assigned to anyone (shown only when you have unlabeled faces). Click the active badge again to deselect.
- **Summary** — The cards below the plot show how many people were identified and the total number of faces in the plot.
- Useful for spotting clustering errors or finding unlabeled faces
