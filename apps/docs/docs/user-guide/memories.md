---
title: "✨ Memories"
description: "Rediscover the photos you took on this day in earlier years"
sidebar_position: 5
---

# Memories

:::note
Memories is not in a released image yet. It is available on the `dev` branch and will appear in the next release.
:::

**Memories** answers "what was I doing a year ago today?". It collects the photos you took around this date in each earlier year and lets you play them back as a slideshow.

Open it from **Memories** in the sidebar, or type "memories" (or "on this day", "years ago") into the [spotlight search](./search.md).

---

## What you see

The page shows one tile per earlier year that has photos near today's date, nearest year first. Each tile carries:

- A **cover photo** — a favourite from that day if there is one, otherwise the earliest still photo. Videos are never used as covers. ("Favourite" here means the rating threshold set by **Minimum image rating to interpret as favorite** in [Settings](./settings/index.md).)
- **How long ago** it was — "1 year ago", "4 years ago".
- **The exact day** and, when reverse geocoding has filled it in, **where you were** — for example *Jul 14, 2022 · Lisbon*.
- **How many photos** that memory holds.

Clicking a tile plays that year as a slideshow. **Play all** at the top plays every year in a row, oldest year first, in the order the photos were taken.

### Tiles and Gallery

The header has a **Tiles / Gallery** switch:

- **Tiles** (the default) shows one cover per year — a quick overview.
- **Gallery** shows all the photos from every memory in the normal photo grid, so you can select, favourite, share or add them to an album exactly as you would anywhere else.

Switching to Gallery, or pressing Play all, fetches the full set of photos; the tiles view only needs the covers, so it stays fast on large libraries.

:::note
A memory returns at most 200 photos per year. If a day of yours is bigger than that, the count on the tile still shows the true total and the page notes that it is *showing the first 200 photos of each year*.
:::

---

## How memories are chosen

A memory is built from the days your timeline already groups photos under, so a memory always covers exactly the days the timeline shows.

- **The window.** An exact "on this day" match is empty on most days for most libraries, so a memory covers the anniversary **plus or minus 3 days**. A weekend trip stays together without pulling in an unrelated week.
- **The month fallback.** If no year has anything in that window, the page widens to whole months instead and shows "August 2019"-style tiles. Better a memory of the right month than an empty page.
- **This year is excluded.** Photos from this year's anniversary are still near the top of your timeline, so they are not a memory yet.
- **29 February** falls back to the 28th in years that do not have one.
- **Your day, not the server's.** The anniversary is taken from your own timezone (**Settings → Metadata Options → Default timezone**), so memories roll over at your midnight rather than the server's.

### What is left out

Memories draw from the same photos your timeline shows — your own photos, not hidden, not in the trash, and only the primary photo of a [stack](./stacks-and-file-variants.md) so a RAW/JPEG pair is not shown twice. On top of that, photos detected as **screenshots** and **documents** are skipped: a screenshot from four years ago is not a memory of anything.

Place names come from reverse geocoding. If you have not run **Add Geolocation**, tiles simply show no place — see [Places](./places.md).

---

## Playback

Playing a memory opens the normal [lightbox](./viewing-photos.md) already in slideshow mode, so everything you know from there still works: the interval dropdown (3, 5, 10, 15 or 30 seconds, defaulting to your **Settings → Slideshow interval**), `s` to stop and start, arrow keys to step through by hand, `f` for fullscreen and `Esc` to close.

Picking a different memory always starts its slideshow from the beginning.

---

## When the page is empty

If you see *"No memories yet"*, your library does not yet reach back more than a year from today — memories only look at **earlier** years. This is expected on a freshly scanned library of recent photos. It also appears if every candidate photo was filtered out, for example a day that holds nothing but screenshots.

Nothing needs to be generated or scheduled: memories are computed when you open the page, so newly scanned photos show up immediately.
