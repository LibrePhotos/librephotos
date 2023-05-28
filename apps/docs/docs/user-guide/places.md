---
title: "🗺 Places"
excerpt: "A overview on how places work"
sidebar_position: 5
---

## The places tab is empty even though my photos have GPS data

To see your places on the map, we have to associate your pictures with actual places with reverse geocoding. At the moment, we use Mapbox for that. We know that a lot of users do not like it due to its pricing model, and we are working on a solution which is free and open source.

To make the places appear, you have to do the following steps:

- create an account on Mapbox
- after login go to 'Tokens' on the main menu
- click on 'Create Token'
- fill out the name (for example 'LibrePhotos')
- leave the public scopes as there are
- check following secret scopes:
  - STYLES:TILES
  - STYLES:READ
  - FONTS:READ
  - DATASETS:READ
  - VISION:READ
  - STYLES:LIST

After that, you have to do a full rescan, and then the places should appear. You can scan up to 100k images for free every month.

## What will I gain from that?

- You can lookup actual places with the search
- Autoalbums will have places in the title and there will be a map where you can see where the photos were that you took
- Place Tree, Location Timeline and the places wordcloud will show up.
