---
title: "🗺 Places"
description: "An overview on how geolocation and places work in LibrePhotos"
sidebar_position: 8
---

LibrePhotos can display your photos on an interactive map based on their GPS coordinates. This page explains how geolocation works and how to get the most out of the Places feature.

## How It Works

### 1. GPS Coordinates from Photos

When you take a photo with a GPS-enabled device (smartphone, camera with GPS, etc.), the location is stored in the photo's EXIF metadata as latitude and longitude coordinates. LibrePhotos reads these coordinates during the scan process:

- `Composite:GPSLatitude` - The latitude coordinate
- `Composite:GPSLongitude` - The longitude coordinate

The scan stores the position right away, also when reverse geocoding is turned off, so the photo shows up on the map before (or without) a place name. The date rules use it in the same scan: a video's creation time or a photo's GPS time is stored in UTC, and the photo's position tells which time zone to turn it into. (Not released yet: up to 1.3.0 the position was only stored by the geocoding job after the scan, so on the first scan these dates fell back to your default time zone; **Rescan** fixes photos scanned before.)

GPS edited in another program is picked up by the next scan: a photo you geotag in digiKam, darktable or a GPX tagger gets the new position and, once the geocoding job has run, its new place. When the GPS is removed from the file (for example with `exiftool -gps:all=` before sharing a folder), the photo loses its position, its place and its Places albums too. A location you set in LibrePhotos (see [Setting a Location Manually](#setting-a-location-manually)) is kept either way. Photos indexed before this change keep a position the file no longer has, because LibrePhotos cannot tell whether you set it; new GPS in their files still replaces it. (Not released yet: up to 1.3.0 a scan never changed or removed a position once the photo had one.)

### 2. Reverse Geocoding

GPS coordinates alone are just numbers. To show meaningful place names (like "Paris, France" or "Central Park, New York"), LibrePhotos uses **reverse geocoding** - a process that converts coordinates into human-readable addresses.

You can configure your preferred geocoding provider in **Admin Area → Site Settings**:

| Provider | API Key Required | Notes |
|----------|-----------------|-------|
| **Nominatim** (OpenStreetMap) | No | Free and open source, default option |
| **Mapbox** | Yes | Commercial service with free tier |
| **MapTiler** | Yes | Commercial service with free tier |
| **OpenCage** | Yes | Commercial service with free tier |
| **TomTom** | Yes | Commercial service with free tier |

:::tip Recommended Setup
**Nominatim** is the recommended option as it's completely free and doesn't require an API key. It uses OpenStreetMap data and works well for most use cases.

To respect Nominatim's public terms of use, LibrePhotos limits itself to about one lookup per second for this provider, and that limit is shared across all background workers — adding more workers won't speed it up. The first scan of a large geotagged library will therefore take a while, and places keep filling in after the scan reports done. If you have tens of thousands of geotagged photos, a commercial provider with an API key geocodes far faster.
:::

### 3. Map Display

LibrePhotos renders maps with **MapLibre GL**. By default the map background (the "tiles") comes from PhotoPrism's free tile server, which provides:

- Smooth, high-quality vector maps
- Fast rendering and zooming
- No API key required for map display
- Works offline once tiles are cached

Admins can change where tiles come from under **Admin Area → Site Settings → Map Tiles**, which sits directly below the Map Provider select. Three options are available:

- **PhotoPrism (default)**: MapLibre vector tiles from `cdn.photoprism.app` and `maps.photoprism.app`.
- **OpenStreetMap**: raster tiles from `tile.openstreetmap.org` (label glyphs from `fonts.openmaptiles.org`).
- **None (hide map)**: no map is rendered anywhere; a placeholder is shown instead.

This setting is global. Choosing **None** hides the map in every map view, including the Places page, album location maps, the photo-info mini-map, and the location picker. The initial value comes from the `MAP_TILE_PROVIDER` environment variable (default `photoprism`), but it is an admin-editable site setting thereafter, so you don't need to restart to change it.

## The Places Page

The Places page (`/album/places`) shows the places in your library on an interactive map. The map plots one marker per detected place name, not one per photo — reverse geocoding records several levels for each photo (country, region, city, point of interest), so a single photo can contribute several markers, and each distinct place name appears only once.

- **Clustered markers**: When zoomed out, nearby places are grouped into clusters; the number shown on a cluster is how many distinct places it contains, not how many photos
- **Click to zoom**: Click on a cluster to zoom in and see individual locations
- **Filtered albums**: As you pan and zoom the map, the album grid below updates to show places visible in the current view
- **Navigation controls**: Use the +/- buttons or scroll to zoom, drag to pan

## Setting Up Places

### Step 1: Configure Map Providers (Optional)

1. Go to **Admin Area → Site Settings**
2. Select your preferred **Map Provider** — this is the geocoding service used to turn coordinates into place names
3. If using a commercial provider, enter your key in the **API key for Map Provider** field
4. Optionally, choose the **Map Tiles** source directly below (PhotoPrism, OpenStreetMap, or None) — this controls the map background rather than geocoding
5. Save the settings

### Step 2: Scan Your Photos

1. Click your avatar (top right) and choose **Library**
2. In the **Scan Library** card, click **Scan** to pick up newly added photos. If your photos are already indexed, open the dropdown next to the button and choose **Rescan** instead — a plain scan skips files that haven't changed
3. The scan extracts GPS coordinates and performs reverse geocoding

See [Library Management](./library.md) for the full list of Library page actions.

### Step 3: View Your Places

Navigate to **Albums → Places** to see your photos on the map.

## Features Enabled by Geolocation

Once your photos have location data:

- **Search by location**: Search for photos by place name (e.g., "Paris", "beach")
- **Events with places**: Event titles include the location
- **Location timeline**: See where you've been over time
- **Place tree**: Hierarchical view of all your locations
- **Photo info**: Individual photos show their location on a mini-map (when map display is enabled), and you can set or correct a photo's location from there

## Setting a Location Manually

If a photo has no GPS data, or has the wrong location, you can set it by hand:

1. Open the photo and find the location line in the info sidebar.
2. Click the pencil (**Update location**) next to it to open the **Pick location** dialog.
3. Set the position by searching for a place name, clicking or dragging the marker on the map, or clicking the crosshair button to use your browser's current location.
4. Click **Save**.

The photo is reverse-geocoded immediately and added to the matching place albums — no rescan required. The pencil is not shown on publicly shared photos. If maps are turned off in Site Settings, the map pane is hidden but place-name search and "use my current location" still work.

If no place name can be found for the new position (reverse geocoding is turned off, the provider fails or rate limits, or the spot has no address, such as open sea), the new coordinates are still saved. The photo then drops the place it had before: it leaves its old place albums, is no longer found by searching the old place name, and the info sidebar shows the coordinates instead of a place name. A notice says that the place name could not be looked up. (Not released yet: up to 1.3.0, the photo kept the old place name and albums in that case, and the dialog reported a plain success.)

## Troubleshooting

### Places tab is empty

1. **Check if photos have GPS data**: Open a photo's info panel and look for GPS coordinates
2. **Scan for new photos**: If you recently added photos, run a **Scan** from the Library page
3. **Check geocoding provider**: Ensure your geocoding provider is configured correctly in **Admin Area → Site Settings**. A commercial provider with a missing or invalid API key fails silently — the scan reports success but no place names are stored
4. **Scan again after fixing the provider**: Go to **Library → Scan Library** and click **Scan**. The geocoding job after it looks up every photo whose position has no place name yet, including the ones whose lookup failed before (not released yet: up to 1.3.0 only photos added since the previous geolocation run, so a full **Rescan** was needed)
5. **Give geocoding time to finish**: Geocoding runs as a background job after the scan. With Nominatim on a large library this can take a while, and places keep filling in after the scan reports done — wait before re-scanning

### Some photos don't show locations

- Not all devices embed GPS data in photos
- Indoor photos may not have accurate GPS
- Some cameras require GPS to be explicitly enabled
- Check if location services were enabled when the photo was taken

A rescan cannot add coordinates that were never in the file. To place such a photo yourself, see [Setting a Location Manually](#setting-a-location-manually).

### Map tiles not loading

- Check your internet connection
- Check **Admin Area → Site Settings → Map Tiles**. If it is set to **None**, maps are disabled on purpose
- With **PhotoPrism (default)**, the tiles come from `cdn.photoprism.app` and `maps.photoprism.app`
- With **OpenStreetMap**, they come from `tile.openstreetmap.org` and `fonts.openmaptiles.org` instead
- Ensure the relevant domains aren't blocked by your firewall or ad blocker. If the PhotoPrism domains are unreachable, switching **Map Tiles** to **OpenStreetMap** (or **None** to hide the map) is an alternative

## Privacy Considerations

- GPS coordinates in photos can reveal sensitive location information
- When sharing photos, consider stripping EXIF data if privacy is a concern
- LibrePhotos keeps your location data private within your instance
- Opening a map fetches tiles for the area around your photos, which reveals their approximate location to the selected tile provider. The photo-info mini-map zooms in tightly, so the tiles it requests pinpoint that photo's location fairly precisely
- You control this with **Map Tiles** in **Admin Area → Site Settings**: *PhotoPrism* (default, tiles from `cdn.photoprism.app` / `maps.photoprism.app`), *OpenStreetMap* (tiles from `tile.openstreetmap.org`, which shifts the exposure to a different provider rather than removing it), or *None* to disable map display entirely so no third-party tile requests are made
