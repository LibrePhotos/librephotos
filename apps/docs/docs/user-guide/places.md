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
| **ExifTool** (offline, built in) | No | Default for new installs. Works offline; names the nearest town, not streets (see [Offline place names](#offline-place-names-with-exiftool)) |
| **Nominatim** (OpenStreetMap) | No | Free and open source; names streets; about one lookup per second |
| **Mapbox** | Yes | Commercial service with free tier |
| **MapTiler** | Yes | Commercial service with free tier |
| **OpenCage** | Yes | Commercial service with free tier |
| **TomTom** | Yes | Commercial service with free tier |

:::tip Recommended Setup
**ExifTool** is the recommended option: it is built in, needs no API key and no Internet access, and your photos' coordinates never leave your server. It names towns rather than streets. <Since version="1.4.0" /> New installs start with it; an install that has already looked up place names keeps the provider it had (Nominatim, unless you chose another), see [Switching the provider](#switching-the-provider).

Choose **Nominatim** if you want street and point-of-interest names. It is free and needs no API key, but it receives the coordinates of your photos. To respect Nominatim's public terms of use, LibrePhotos limits itself to about one lookup per second for this provider, and that limit is shared across all background workers — adding more workers won't speed it up. The first scan of a large geotagged library will therefore take a while, and places keep filling in after the scan reports done. If you have tens of thousands of geotagged photos, a commercial provider with an API key geocodes far faster.
:::

#### Offline place names with ExifTool

<Since version="1.4.0" />

Choose **ExifTool (offline, built in)** as the **Map Provider** to look place names up on your own server. ExifTool, which LibrePhotos already uses to read metadata, comes with a database of the world's towns, so the lookup needs no Internet connection and no API key, has no rate limit (about 9 ms per photo instead of more than a second with Nominatim), and your photos' coordinates never leave the server.

What to expect:

- **Town level.** A photo gets its nearest town or neighbourhood (towns of 2,000 people or more), the district, the region and the country, for example *Zermatt, Visp District, Valais, Switzerland*. There are no street, park or point-of-interest names; choose Nominatim or a commercial provider if you want those. A name that repeats on several levels is kept once, so Lisbon is *Lisbon, Portugal*.
- **Names in English or Latin script.** The names come from GeoNames and are the same for every user (*Germany*, *Tokyo*), not in the language of each country.
- **Nothing within 50 km means no place.** A photo farther than 50 km from any town (open sea, a large national park, the Antarctic) keeps its position and stays on the map, but gets no place name and joins no Places album, rather than the name of a town far away.
- **Borders.** The database knows towns, not borders: a photo taken close to a border can get the name of a town across it (on Kilimanjaro, the nearest town is in Kenya).
- **Place search in the location picker** still uses Nominatim, because ExifTool cannot search addresses. Only the text you type is sent, never a photo's position. On a server without Internet access the search fails, but clicking the map and pasting coordinates still work.

Place names from ExifTool come from [GeoNames](https://www.geonames.org/) and are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

#### Switching the provider

Switching the **Map Provider** does not rename photos that already have a place: new photos, and photos whose position changes, get names from the new provider, so your Places albums mix the names of both.

<Since version="1.4.0" /> To give every photo the names of the new provider, an admin opens **Admin Area → Admin Tools** and clicks **Start** next to **Look up place names again**, then confirms. A **Look Up Place Names** job asks the provider set now for the place of every photo with a location, for every user, and you can follow it in **Worker Logs**:

- Each photo moves to the Places albums of its new names. Places albums under the old names end up empty, favourited or shared ones included.
- The day albums (and the memories built from them) name their places again as the job reaches their photos.
- Event titles keep their wording until the event albums are generated again (**Regenerate Event Titles**).
- With ExifTool it takes minutes for a large library. With an online provider it takes about a second per photo (Nominatim's limit), so hours for tens of thousands of photos.
- A photo whose lookup fails keeps its old place, and the next run tries it again.

#### Which name a photo is filed under

Every provider answers several names, from the street or town up to the country. The day albums, memories, event titles and the map button of an event ("Zermatt on map") use the town (Zermatt, not the canton Valais); the place tree uses the country, the region and the town; the location timeline uses the country. <Since version="1.4.0" /> These read the level each name has. Up to 1.3.0 they took the name at a fixed position in the list, which named the region for some providers, and the place tree left out places with fewer than three names (*Lisbon, Portugal*). Photos geocoded before 1.4.0 keep the names they showed until you look the place names up again.

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

In dark mode every map is shown darkened: LibrePhotos inverts the light map in the browser and turns its colours back, so water stays blue and parks stay green, and the place markers keep their colours. This works for both tile sources and loads nothing extra. (Not released yet: up to 1.3.0, maps stayed light in dark mode.)

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
3. Set the position by searching for a place name, pasting coordinates such as `48.8566, 2.3522` into the search box and choosing **Use coordinates**, clicking or dragging the marker on the map, or clicking the crosshair button to use your browser's current location.
4. Check the place name under the map: it is the name the photo gets when you save. It reads **Place name unavailable** when the server has no name for the spot (the coordinates are saved anyway), and says so when place names are turned off on the server.
5. Click **Save**.

The photo is reverse-geocoded immediately and added to the matching place albums — no rescan required. The pencil is not shown on publicly shared photos. If maps are turned off in Site Settings, the map pane is hidden but place-name search, pasted coordinates and "use my current location" still work.

A photo without a location opens the dialog where the nearest geotagged photo taken within a day of it was taken, or on a world map when there is none. The browser only asks for your position when you click the crosshair button (not released yet: up to 1.3.0 it asked as soon as the dialog opened, and started over Paris without permission).

Above the search box, **Copy from a photo taken nearby in time** shows up to 20 of your photos that have a location and were taken within a day of this one, nearest first, each with its place and how long before or after it was taken. Click one to put the marker on its location; its place name is shown at once. Handy for camera photos taken next to a phone that recorded GPS. (Not released yet.)

### Setting the location of many photos

Photos from a camera without GPS, scans and screenshots often need the same location. Select them on the timeline or any photo page (or use **Select all**), open the **⋮** photo actions menu and choose **Set location…**:

1. The dialog says how many of the selected photos already have a location. By default only the photos **without a location** get the new one; choose **All N photos** to replace the others too. The dialog then names the places that would be replaced. When every selected photo has a location, saving replaces them all, and the dialog says so.
2. Pick the spot as for a single photo: search, paste coordinates, click the map, use your current location, or click a photo under **Copy from a photo taken nearby in time** (your geotagged photos taken within a day of the selection).
3. Click **Set location for N photos**.

The place name is looked up once for all of them. Each photo gets the position, its place albums and location search, and its own entry in the edit history; the confirmation says how many photos got the location and how many kept their own. If the place name cannot be looked up, the coordinates are saved anyway and the confirmation says so. With [Write edits to files](./settings/index.md#metadata-options) on, the new location is written to the photo files or sidecars in one background job. To remove the location of photos, use **Remove location** on each photo. (Not released yet.)

### Removing a location

If a photo has a wrong location (a phone that reused a stale GPS fix, a scan that inherited the scanner's position), open the **Pick location** dialog and click **Remove location**, then confirm. The photo leaves the map, its place albums and location search, and a rescan does not bring the location back; set a location again in the same dialog. With [Write edits to files](./settings/index.md#metadata-options) set to `Save to media file`, the location is also removed from the photo file; with `Save to sidecar`, it is removed from the sidecar, and a location stored in the photo file itself stays there. With `Off` the photo file is not changed. The dialog says which applies. **Remove location** is only shown for a photo that has one. (Not released yet.)

If no place name can be found for the new position (reverse geocoding is turned off, the provider fails or rate limits, or the spot has no address, such as open sea), the new coordinates are still saved. The photo then drops the place it had before: it leaves its old place albums, is no longer found by searching the old place name, and the info sidebar shows the coordinates instead of a place name. When the lookup failed, a notice says that the place name could not be looked up; when it worked but there is no place at that spot, the confirmation says so instead. (Not released yet: up to 1.3.0, the photo kept the old place name and albums in that case, and the dialog reported a plain success.)

## Troubleshooting

### Places tab is empty

1. **Check if photos have GPS data**: Open a photo's info panel and look for GPS coordinates
2. **Scan for new photos**: If you recently added photos, run a **Scan** from the Library page
3. **Check geocoding provider**: Ensure your geocoding provider is configured correctly in **Admin Area → Site Settings**. A commercial provider with a missing or invalid API key fails silently — the scan reports success but no place names are stored
4. **Scan again after fixing the provider**: Go to **Library → Scan Library** and click **Scan**. The geocoding job after it looks up every photo whose position has no place name yet, including the ones whose lookup failed before, but not the ones where the provider found no place, such as open sea (not released yet: up to 1.3.0 only photos added since the previous geolocation run, so a full **Rescan** was needed)
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
