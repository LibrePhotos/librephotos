---
title: "📊 Statistics & Data Visualization"
description: "Explore your photo library through interactive visualizations"
sidebar_position: 10
---

LibrePhotos includes a **Statistics** section with several interactive visualizations that help you explore patterns in your photo library. It is not in the main sidebar — open it from the **Statistics / Explore charts** card at the top of the **Library** page (reach the Library page from the avatar menu in the top-right corner → **Library**), or press `Ctrl+K` (`Cmd+K` on macOS) and search for "Statistics". You can also go straight to `/statistics`. The section opens on the **Place Tree** view, and a tab bar at the top lets you switch between the five views.

## Place Tree

The Place Tree shows all your photo locations organized in a hierarchical tree — from countries down to regions and cities. This gives you a bird's-eye view of everywhere you've taken photos.

- **Multiple layouts** — Switch between the tree layout (shown horizontally or vertically) and a radial layout
- **Link style** — Switch the connectors between curved, step and straight lines
- **Expand / collapse** — Click on any node to expand or collapse its children
- **Pan** — Drag anywhere on the canvas to move around the tree
- **Zoom** — Scroll to zoom, or use the zoom in / out / reset buttons; the keyboard shortcuts `+`, `-` and `0` (reset) also work
- **Hover** — Hover over a node to see its full name and photo count

## Timeline

The Timeline view provides two charts that show how your photo-taking habits have changed over time:

### Photo Count per Month

A bar chart showing how many photos you took each month. This makes it easy to spot busy months (vacations, events) vs. quieter periods.

### Location Duration

A single horizontal stacked bar spanning your whole library, laid out chronologically. Each colored segment is one continuous stay at a location, and the segment's **width** shows how long that stay lasted. Hover over a segment to see the location name and the month-and-year range it covers; the color legend underneath lists every segment. Note that each stay gets its own color, so a place you visited more than once appears more than once. This is great for seeing travel patterns at a glance.

## Word Clouds

Three interactive word clouds generated from your photo library:

| Cloud | Based on |
|-------|----------|
| **Places** | Place names from reverse geocoding (postcodes and points of interest are skipped) |
| **Things** | Scene tags from the Places365 classifier — its scene categories, scene attributes and the indoor/outdoor label. The categories and attributes are also what populate your Things albums. |
| **People** | Names of recognized people in your photos |

Each cloud shows at most the top 100 terms, and larger words appear more frequently in your library. **Click on any word** to search for photos matching that term.

:::note
The **Things** cloud is only populated when your photos are tagged with the Places365 model. With the SigLIP 2 tagging model its tags are stored differently, so this cloud stays empty.
:::

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
