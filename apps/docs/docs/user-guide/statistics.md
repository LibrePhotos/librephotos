---
title: "Statistics and data visualization"
description: "Explore your photo library through interactive visualizations"
sidebar_position: 10
---

LibrePhotos includes a **Statistics** section with several interactive visualizations that help you explore patterns in your photo library. It is not in the sidebar: open it with **View statistics** at the top right of the **Library** page (**Account menu > Library**), or press `Ctrl+K` (`Cmd+K` on macOS) and search for "Statistics". You can also go straight to `/statistics`. The page starts with the same counts as the Library page, then a tab bar to switch between the five views: **Timeline** (where it opens), **Place tree**, **Word clouds**, **Social graph** and **Face clusters**.

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

A calendar heatmap like a contribution graph: every column is a week and every cell a day, and the deeper the colour the more photos you took that day. It shows one calendar year at a time, from January to December (the current year up to today). The year picker next to the title lists every year you have dated photos in, including years before 2000, and starts on the latest one. The five shades are relative to the year shown, so a quiet year still shows its busiest days in the deepest shade.

Only the photos you see in your library count: hidden photos, photos in the trash and photos without a date are left out, so clicking a day always opens the photos it counts.

Hover or focus a cell to see the date and its count, and click a day (or press `Enter` on it) to open that day's photos in the search view. With the keyboard, the left and right arrow keys move by a week, up and down by a day, and `Home` and `End` jump to the first and the last day. On a narrow screen the cells keep a size you can tap and the year scrolls sideways, starting at its latest week.

### Location Duration

A single horizontal stacked bar spanning your whole library, laid out chronologically. Each colored segment is one continuous stay at a location, and the segment's **width** shows how long that stay lasted. Hover over a segment to see the location name and the month-and-year range it covers; the color legend underneath lists every segment. Note that each stay gets its own color, so a place you visited more than once appears more than once. This is great for seeing travel patterns at a glance.

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
