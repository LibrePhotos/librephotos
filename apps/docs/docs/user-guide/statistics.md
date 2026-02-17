---
title: "📊 Statistics & Data Visualization"
excerpt: "Explore your photo library through interactive visualizations"
sidebar_position: 10
---

LibrePhotos includes a **Statistics** section with several interactive visualizations that help you explore patterns in your photo library. You can access it from the main navigation.

## Place Tree

The Place Tree shows all your photo locations organized in a hierarchical tree — from countries down to regions and cities. This gives you a bird's-eye view of everywhere you've taken photos.

- **Multiple layouts** — Switch between vertical, horizontal, and radial tree layouts
- **Expand / collapse** — Click on any node to expand or collapse its children
- **Zoom** — Scroll to zoom in and out of the tree
- **Click to search** — Click on a location node to search for photos taken there

## Timeline

The Timeline view provides two charts that show how your photo-taking habits have changed over time:

### Photo Count per Month

A bar chart showing how many photos you took each month. This makes it easy to spot busy months (vacations, events) vs. quieter periods.

### Location Duration

A stacked bar chart showing how much time you spent at different locations over time. Each color represents a different location, and the bar height shows the duration. This is great for seeing travel patterns at a glance.

## Word Clouds

Three interactive word clouds generated from your photo library:

| Cloud | Based on |
|-------|----------|
| **Locations** | Place names from reverse geocoding |
| **Captions & Things** | AI-generated captions and detected objects |
| **People** | Recognized people in your photos |

Larger words appear more frequently in your library. **Click on any word** to search for photos matching that term.

## Social Graph

A force-directed graph showing the relationships between people in your photos. Each node represents a person, and edges connect people who appear together in the same photos.

- **Node size** reflects how many photos a person appears in
- **Edge thickness** reflects how often two people appear together
- **Drag** nodes to rearrange the layout
- **Zoom** to explore dense areas of the graph

This is a fun way to see social connections and who you photograph together most often.

## Face Clusters

A visualization of your face recognition clusters. Shows face thumbnails grouped by person, giving you an overview of how the face clustering algorithm has grouped the detected faces.

- Click on any face thumbnail to open that photo in the lightbox
- Useful for spotting clustering errors or finding unlabeled faces
