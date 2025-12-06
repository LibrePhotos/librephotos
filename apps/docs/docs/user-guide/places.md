---
title: "🗺 Places"
excerpt: "An overview on how geolocation and places work in LibrePhotos"
sidebar_position: 5
---

LibrePhotos can display your photos on an interactive map based on their GPS coordinates. This page explains how geolocation works and how to get the most out of the Places feature.

## How It Works

### 1. GPS Coordinates from Photos

When you take a photo with a GPS-enabled device (smartphone, camera with GPS, etc.), the location is stored in the photo's EXIF metadata as latitude and longitude coordinates. LibrePhotos reads these coordinates during the scan process:

- `Composite:GPSLatitude` - The latitude coordinate
- `Composite:GPSLongitude` - The longitude coordinate

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
:::

### 3. Map Display

LibrePhotos uses **MapLibre GL** with vector tiles from PhotoPrism's free tile server. This provides:

- Smooth, high-quality vector maps
- Fast rendering and zooming
- No API key required for map display
- Works offline once tiles are cached

## The Places Page

The Places page (`/album/places`) shows all your geotagged photos on an interactive map:

- **Clustered markers**: When zoomed out, nearby photos are grouped into clusters showing the count
- **Click to zoom**: Click on a cluster to zoom in and see individual locations
- **Filtered albums**: As you pan and zoom the map, the album grid below updates to show places visible in the current view
- **Navigation controls**: Use the +/- buttons or scroll to zoom, drag to pan

## Setting Up Places

### Step 1: Configure Geocoding Provider (Optional)

1. Go to **Admin Area → Site Settings**
2. Select your preferred **Map API Provider**
3. If using a commercial provider, enter your **API Key**
4. Save the settings

### Step 2: Scan Your Photos

1. Go to **Settings → Scan Directory**
2. Run a full scan of your photo library
3. The scan will extract GPS coordinates and perform reverse geocoding

### Step 3: View Your Places

Navigate to **Albums → Places** to see your photos on the map.

## Features Enabled by Geolocation

Once your photos have location data:

- **Search by location**: Search for photos by place name (e.g., "Paris", "beach")
- **Auto-albums with places**: Automatically created albums include location in their titles
- **Location timeline**: See where you've been over time
- **Place tree**: Hierarchical view of all your locations
- **Photo info**: Individual photos show their location on a mini-map

## Troubleshooting

### Places tab is empty

1. **Check if photos have GPS data**: Open a photo's info panel and look for GPS coordinates
2. **Run a rescan**: If you recently added photos, run a new scan
3. **Check geocoding provider**: Ensure your geocoding provider is configured correctly in Site Settings

### Some photos don't show locations

- Not all devices embed GPS data in photos
- Indoor photos may not have accurate GPS
- Some cameras require GPS to be explicitly enabled
- Check if location services were enabled when the photo was taken

### Map tiles not loading

- Check your internet connection
- The map uses PhotoPrism's tile server at `cdn.photoprism.app` and `maps.photoprism.app`
- Ensure these domains aren't blocked by your firewall or ad blocker

## Privacy Considerations

- GPS coordinates in photos can reveal sensitive location information
- When sharing photos, consider stripping EXIF data if privacy is a concern
- LibrePhotos keeps your location data private within your instance
- The map tile server only receives tile requests, not your photo locations
