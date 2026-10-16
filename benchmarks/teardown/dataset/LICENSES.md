# Dataset licences

Every file the benchmark downloads is released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication).
`build_manifest.py` keeps a file only when its source says CC0. `manifest.json` records the licence,
author, source page and hashes of each file, so every file can be traced back.

| Part | Source | Licence | Notes |
| --- | --- | --- | --- |
| `clean/jpeg-unsplash`, `clean/jpeg-people` | Wikimedia Commons, [Images from Unsplash](https://commons.wikimedia.org/wiki/Category:Images_from_Unsplash) | CC0 1.0 | Uploaded while Unsplash was CC0 (before June 2017). Later Unsplash photos use the non-free Unsplash License; Commons does not host those, and the builder skips anything not marked CC0. Camera EXIF is mostly intact. |
| `clean/jpeg-gps` | Wikimedia Commons, own-work photos in [CC-Zero](https://commons.wikimedia.org/wiki/Category:CC-Zero) with GPS in EXIF | CC0 1.0 | Picked for places and maps. |
| `clean/png` | Wikimedia Commons, CC-Zero PNGs | CC0 1.0 | Screenshots, scans and graphics, as found in real libraries. |
| `clean/video-webm` | Wikimedia Commons, CC-Zero WebM | CC0 1.0 | Short clips, under 12 MB. |
| `clean/raw` | [raw.pixls.us](https://raw.pixls.us/) | CC0 1.0 | One sample per RAW format (CR2, CR3, NEF, ARW, RAF, ORF, RW2, DNG). The site publishes a sha256 for each file and lists its few non-CC0 samples separately; the builder skips those. |
| `derived/heic` | Re-encoded from `clean/jpeg-*` by `derive_formats.py` | CC0 1.0 (derivative of CC0) | Commons does not accept HEIC. |
| `derived/mp4` | Synthetic `ffmpeg testsrc2` clips | No third-party content | Generated on every run. |
| `messy/` | Copies of `clean/` files changed by `make_messy.py` (ExifTool) | CC0 1.0 (derivative of CC0) | Broken EXIF, sidecars, duplicates, odd folder names. |
| `interop/` | Copies of `clean/` files (JPEGs and RAWs) given digiKam / Lightroom / darktable / Windows Photo Gallery metadata by `make_interop.py` | CC0 1.0 (derivative of CC0) | The person names on the face regions are invented ("Ada Teardown"); they label fixed rectangles, not the people in the photos. |

CC0 requires no attribution. The authors are still listed in `manifest.json` (fields `author`,
`credit` and `page`) out of courtesy and so a file can be checked against its source.

## What this set is not

- **Not Pexels.** Pexels photos are under the Pexels licence, which is not CC0 and forbids selling
  unaltered copies. Downloading them also needs an API key. Commons' CC0 Unsplash imports serve the
  same "stock photo" role without either problem.
- **No phone HEICs straight from a camera.** The HEICs are re-encoded JPEGs with their EXIF copied
  over. They exercise HEIC decoding, but not Apple-specific extras such as depth maps or Live Photos.
- **Not a face-recognition accuracy set.** The `jpeg-people` stratum gives the face pipelines some
  work, using portraits that were published as CC0 stock photography. It has no identity labels. If
  a person in a photo asks to be removed, delete the entry from `manifest.json` and rebuild.
