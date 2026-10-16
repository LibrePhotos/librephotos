# LibrePhotos positioning (hypothesis, 2026-10-16)

**Status: hypothesis.** It is built from primary evidence (below), but it has not been tested with people outside the maintainer team. It stays a hypothesis until the checks in [`05-validation-kit.md`](05-validation-kit.md) pass. Every claim links to evidence in [`research/`](research/). Read the "Caveat" lines: several advantages only hold from 1.4.0, or only with a non-default setting. The teardown benchmark has run once with usable results ([run 2](research/05-teardown-run-2.md)). §2.1 lists what it confirmed and what it disproved.

## TL;DR

- **Stop positioning LibrePhotos as a "Google Photos alternative".** That job is decided by automatic phone backup and the "spouse test". Immich has won it: in our sample, 20 of 28 PhotoPrism leavers since mid-2023 went to Immich. LibrePhotos has no released phone app.
- **Position it as the photo server for a library you already curate.** These are people whose photos live in folders and whose tags and faces live in XMP, from digiKam, Lightroom, darktable or a NAS. They want their household to browse and search it with good face recognition, without a second copy, a new silo or files being moved.
- **The claims that survive competitors' own code and the benchmark:**
  1. The only self-hosted photo server that runs natively on Windows.
  2. The only one that writes face regions back to standard XMP, and lets you choose between the file itself and a sidecar. Measured on dev: rating, caption, keyword and named faces all landed in the XMP sidecar or the original.
  3. It reads the face names digiKam wrote. Immich shows none of them on defaults.
  4. No automatic trash expiry. Immich's 30-day expiry is on, and permanent delete removed the original from its external library.
  5. Peak RAM was about half of Immich's: 2.1 to 2.4 GB against 5.0 GB.
- **What the benchmark disproved or narrowed.**
  - "Never touches your files" is **not** a differentiator. On defaults, none of the three apps moved, renamed or rewrote anything unasked.
  - LibrePhotos is **not** the lightest. PhotoPrism idled at about 740 MiB after indexing; LibrePhotos idled at 1.8 to 2.0 GB.
  - **On defaults, Immich writes more back than LibrePhotos does.** Immich always writes rating, description and keywords to XMP. LibrePhotos writes nothing until a setting is switched on.
- **Four things have to change for the positioning to be true by default.**
  - Write-back is **off** by default.
  - Caption, keyword and GPS write-back only ship in **1.4.0**.
  - Importing other tools' metadata has measured gaps: hierarchical keywords are flattened, digiKam's tag tree isn't read, and Windows Photo Gallery face regions aren't read.
  - LibrePhotos accepts write-back on a read-only library and silently writes nothing.

## 1. Competitive alternatives (what the best-fit user would do without LibrePhotos)

The best-fit user (§4) is not comparing LibrePhotos with Google Photos. They are choosing between:

| Alternative | Why they consider it | Why it falls short for them | Evidence |
| --- | --- | --- | --- |
| **Immich with an external library** | The default recommendation, polished, phone app; writes rating, description and keywords to XMP sidecars by default; keeps keyword hierarchies | No face write-back; doesn't show digiKam's face names on defaults; downloads leave out the `.xmp`, so edits don't travel (measured: 0 sidecars in the export); 30-day trash auto-expiry is on and permanent delete removes the original from an external library (measured); peak RAM 5.0 GB on 370 photos | [source truth (b), (c), (d)](research/04-source-truth.md#matrix); FAQ "metadata cannot be edited for files in read-only external libraries" ([issue mining §2](research/02-issue-mining.md#2-jobs-to-be-done-ranked-by-total-reactions)) |
| **digiKam (or Lightroom Classic) alone, shared over SMB or Nextcloud** | Where the curation already happens | Single-user desktop apps: the household can't browse or search, and there's no web or phone view | [switch stories §4.2](research/01-switch-stories.md#42-the-metadata-curator-digikam--lightroom--darktable): "It's the part with the (Android) app and the server to view the photos that's missing." |
| **PhotoPrism** | Indexes in place, real read-only mode, XMP read | No XMP write-back (proprietary YAML only); no ratings; multi-user roles and admin UI are paid; weaker faces in user reports | [source truth (b), (e)](research/04-source-truth.md#matrix); [trajectories §3](research/03-trajectories.md#3-claimability-can-a-competitor-truthfully-claim-our-differentiator-today) |
| **Synology Photos** | Already on the NAS, folder-native, iOS sync "just works" | Writes back only to jpg, png and cr2, with no sidecars and no faces or location; recognition depends on NAS model and RAM | [commercial](research/03b-commercial.md) |
| **Nextcloud Memories** | Already on Nextcloud, writes EXIF in place | Faces come from a separate app (Recognize); slow at large libraries; no face write-back | [source truth](research/04-source-truth.md#matrix); [switch stories §2.7](research/01-switch-stories.md#27-perf-speed-at-the-users-library-size) |

## 2. Unique attributes (only those that survived the claimability check)

A claim is listed only if no competitor in [`research/03-trajectories.md` §3](research/03-trajectories.md#3-claimability-can-a-competitor-truthfully-claim-our-differentiator-today) can truthfully claim it today, as checked against their **code**, not their docs, in [`research/04-source-truth.md`](research/04-source-truth.md).

| # | Attribute | Proof | Caveat | Durability |
| --- | --- | --- | --- | --- |
| A | **Native Windows server, no Docker.** CI builds a Nuitka zip on `windows-latest` and attaches it to every release since 1.2.0. | [source truth (a)](research/04-source-truth.md#matrix). Immich's native-Windows ML PR was closed unmerged; its docs require Docker and no NTFS | It works, but is it easy? The first-hour experience on a clean Windows PC is unmeasured | **High.** No competitor shows motion here ([threat 7](research/03-trajectories.md#4-threats-what-could-erase-a-librephotos-advantage-in-6-to-12-months)) |
| B | **Metadata round-trip including faces.** Writes MWG-RS face regions, ratings and dates, to the original or an XMP sidecar (user's choice), and reads face names from digiKam files. | [source truth (b), (f)](research/04-source-truth.md#matrix). Only digiKam matches it, and digiKam is a desktop app. **Measured** ([run 2](research/05-teardown-run-2.md)): dev wrote rating, caption and keyword to `xmp` or `file` and named face regions 2/2 in both modes; 1.3.0 wrote rating and faces only. digiKam face names were read by LibrePhotos and PhotoPrism, not by Immich | **Off by default** (`save_metadata_to_disk = OFF`, `save_face_tags_to_disk = False`, `apps/backend/api/models/user.py:97-100`). On defaults Immich writes more (r/d/k to XMP). Caption, keyword and GPS write-back are **dev only**, so 1.4.0. Whether the export carries the sidecars is **unmeasured** (harness bug in run 2) | **Medium.** Two Immich community PRs for face XMP were closed unmerged in 2026, but the idea hasn't been rejected ([threat 1](research/03-trajectories.md#4-threats-what-could-erase-a-librephotos-advantage-in-6-to-12-months)) |
| C | **No automatic trash expiry by default.** Nothing is deleted from disk unless the user empties the trash. | [source truth (c)](research/04-source-truth.md#matrix): `TRASH_RETENTION_DAYS` defaults to 0. **Measured** ([run 2](research/05-teardown-run-2.md)): Immich's 30-day expiry is on, and its permanent delete removed the original and its sidecar from a read-write external library | **Narrowed by the benchmark.** On defaults, *no* app moved, renamed or rewrote files unasked, so "never touches your files" is shared. All three delete the original and its `.xmp` on permanent delete. Automatic trash expiry exists only on dev (1.4.0) | **Low to medium.** One default, which Immich could change in a release |
| D | **All ML on CPU in one container**, 4 GB recommended, ARM64, AI can be switched off with no models downloaded. **Local captions that name the people and places** in the photo. | [source truth (d)](research/04-source-truth.md#matrix); [trajectories, commoditization map](research/03-trajectories.md#2-commoditization-map-wardley-style). **Measured** on 370 photos ([run 2](research/05-teardown-run-2.md)): peak RAM 2.1 to 2.4 GB (Immich 5.0 GB, PhotoPrism 2.0 to 2.3 GB); idle after indexing 1.8 to 2.0 GB (Immich 2.7 GB, PhotoPrism 0.74 GB) | Say "about half of Immich's memory", never "lightest": PhotoPrism idles at well under half of LibrePhotos. The resident ML sidecars are the likely cost (not yet profiled). The run says nothing about the 4 GB docs claim on a big library. Captions are the cheapest advantage to copy | Captions: **low** (a 6 to 12 month head start). Footprint: **medium**, since Immich's leaner models will become the default ([threat 2](research/03-trajectories.md#4-threats-what-could-erase-a-librephotos-advantage-in-6-to-12-months)) |
| E | No company, MIT licence, no paid tier or licence key | [source truth (e)](research/04-source-truth.md#matrix) | Weak against Immich ("never any paywalled features"). "Community-governed" is undercut by 82 % of commits coming from one maintainer. Say "no company, MIT" | Supporting claim only |

**Shared or commodity, so don't lead with them:** faces, CLIP search, maps, OIDC, memories, OCR (four tools added OCR in the last 12 months) and folder views ([commoditization map](research/03-trajectories.md#2-commoditization-map-wardley-style)).

**One open hypothesis worth testing.** LibrePhotos' face *quality* is its most praised pull: 10 of 27 "toward" stories, including "shines the brightest" against Immich and PhotoPrism ([switch stories §3.1](research/01-switch-stories.md#31-why-people-pick-librephotos-27)). Having faces is commodity, but quality may not be. Nobody has measured it. A labelled face set in the benchmark would settle it.

### 2.1 What the teardown benchmark showed (run 2, 2026-10-16)

[Full tables](research/05-teardown-run-2.md). Setup: 370 media files, one `ubuntu-latest` runner per job, each project's defaults, one run each, so treat small gaps as noise.

| | LibrePhotos 1.3.0 | LibrePhotos dev | Immich v3.3.3 | PhotoPrism 261007 |
| --- | --- | --- | --- | --- |
| Startup (s) | 25 | 28 to 29 | 8 | 13 to 18 |
| All photos visible (s) | 102 to 107 | 97 to 107 | 184 | 90 to 120 |
| All background jobs done (s) | over 235 (budget ran out) | 209 to 214 | 371 | 95 to 130 |
| Peak RAM (GB) | 2.1 | 2.1 to 2.4 | 5.0 | 2.0 to 2.3 |
| Idle RAM after indexing (GB) | 1.8 to 1.9 | 1.8 to 2.0 | 2.7 | 0.74 |
| Write-back on defaults (rating / description / keyword) | none | none | XMP / XMP / XMP | own YAML (description only) |
| Write-back switched on | rating + named faces | everything, to XMP or the file | (always on, no switch) | (none) |
| digiKam face names read | yes | yes | no | yes |
| Lightroom keywords | flat `dc:subject` only | flat + `lr:hierarchicalSubject`, hierarchy flattened | hierarchy kept (but not the flat list) | flat `dc:subject` only |
| Windows Photo Gallery face regions | no | no | no | yes |
| Ratings from other tools | yes | yes | yes | no (no rating field) |
| Moved / renamed / rewritten unasked on defaults | 0 | 0 | 0 | 0 |
| Automatic trash expiry | off | off | **30 days** | off |

**Takeaways for the positioning**
- **Confirmed:** face write-back and digiKam face import (B), the trash-expiry difference (C) and the RAM gap against Immich (D).
- **Disproved:** "the lightest server" and "never touches your files" as differentiators.
- **New product gaps:** keyword hierarchies get flattened (Immich keeps them); digiKam's own `TagsList` and Windows Photo Gallery's `MP:RegionInfo` aren't read; LibrePhotos is the slowest to start; switching write-back on for a read-only library fails silently.
- **Switching on face write-back in `MEDIA_FILE` mode rewrites a lot of originals.** On dev, the library-wide "Write metadata to files" job then rewrote 87 of 363 originals (every photo with a detected face, with unnamed boxes) and created 79 sidecars. That's what was asked for, but it argues for `SIDECAR_FILE` if the default changes (§8 row 1).
- **Still unmeasured:**
  - Immich with a read-only library (its image pull was rate-limited).
  - Whether exports carry the edits (harness bug).
  - Anything at 100k+ photos.

## 3. Value (what the attributes let the best-fit user do)

- **Years of curation survive and keep flowing.**
  - Tags, ratings and named faces made in digiKam or Lightroom show up for the household.
  - Corrections made in LibrePhotos land back in standard XMP, so digiKam sees them next time.
  - Users said: "really don't want to go through the tagging/face recognition step again" and "I refuse to be sucked into another proprietary database" ([§2.9](research/01-switch-stories.md#29-meta-metadata-in-the-files-21)).
- **One copy, on disk, untouched.** No reorganised folder tree, no UUID filenames, and no auto-delete after 30 days ([§2.5](research/01-switch-stories.md#25-folders-my-files-my-structure-one-copy-31)).
- **Leaving costs nothing.** Everything LibrePhotos learned is in the files, not in its database.
- **It runs on the machine that already holds the photos,** including a Windows PC or a low-power box ([§4.5, §4.7](research/01-switch-stories.md#4-underserved-segments)).

## 4. Best-fit users

**Primary: the curator household.** One person curates a photo library in folders, often with digiKam, Lightroom Classic or darktable, or on a NAS fed by Syncthing, Nextcloud or SMB. They want the rest of the household to browse, search and find people in it from a browser.

- Evidence: [switch stories §4.2 and §4.3](research/01-switch-stories.md#4-underserved-segments). Each segment has three or more independent authors, and both LibrePhotos stories from 2026 are digiKam users ([#119](https://github.com/LibrePhotos/librephotos/issues/1979), [#118](https://github.com/LibrePhotos/librephotos/issues/2151)).
- Size signal: "my files are the truth" adds up to about 1,000 reactions across trackers, and most of it is hidden because Immich rules it out in its FAQ rather than in issues ([issue mining §2](research/02-issue-mining.md#2-jobs-to-be-done-ranked-by-total-reactions)).

**Secondary (served by the same product, with no extra positioning):**
- **Windows-only households** that won't run Docker ([§4.7](research/01-switch-stories.md#47-windows-only-no-docker-households)).
- **Low-power box owners** who still want ML ([§4.5](research/01-switch-stories.md#45-low-power-box-owners-who-still-want-ml)).

**Who it is not for (say so openly):**
- **Phone-first families who want an iCloud or Google Photos replacement with background backup.** Use Immich or Ente until LibrePhotos' mobile app ships.
- **People who need end-to-end encryption.** Use Ente.
- **People who want a photo editor.** LibrePhotos has none.

## 5. Market category

**Not** "self-hosted Google Photos alternative." In that category LibrePhotos is compared on phone backup and loses.

**Proposed:** *a self-hosted photo server for the library you already have.* That is the category digiKam and Lightroom users already reach for when they ask for "the server part that's missing". It sets the right comparison: Immich's external library, PhotoPrism and Synology Photos, not Immich's phone app.

## 6. Positioning paragraph (the text for the repeat-back test)

> LibrePhotos is a self-hosted photo server for the library you already have. Point it at your photo folders, whether that's a NAS share, a Nextcloud folder or the drive on your Windows PC, and your household gets a fast web timeline with face recognition, search and albums. Tags, ratings and named faces you made in digiKam or Lightroom show up as they are, and changes you make in LibrePhotos are written back to standard XMP so your other tools see them too. Your files are never moved, renamed or copied. Everything runs on your own hardware, with no company, no paid tier and no lock-in: if you stop using it, everything it learned is already in your files.

This paragraph is true only after the product changes in §8 rows 1 to 3b. Until then it overclaims write-back (off by default, captions and keywords on dev only) and "show up as they are": keyword hierarchies are flattened and Windows Photo Gallery faces aren't read (measured in run 2). "Never moved, renamed or copied" is true but shared; it reassures, it doesn't differentiate.

## 7. Blue Ocean ERRC grid

| Eliminate | Reduce |
| --- | --- |
| Competing to be "the Google Photos replacement" in messaging | Investment in features that are now commodity (more map styles, more memory types) as headline items |
| Any path where LibrePhotos owns or reorganises files | Setup steps: one container, one path, done |

| Raise | Create |
| --- | --- |
| Fidelity of *importing* metadata from digiKam, Lightroom and darktable (face regions, hierarchical keywords, both sidecar naming styles) | A two-way XMP contract with desktop tools, documented and tested in CI against fixture files from each tool |
| First-index speed on 100k+ libraries, published as numbers | A public, rerunnable teardown benchmark (`benchmarks/teardown/`) as a marketing asset |
| Write-back on by default, wherever the library is writable | "Leaving costs nothing" proof: export, then re-import into digiKam, and nothing is lost |

## 8. What has to be true (product work the positioning depends on)

Ranked by how much the positioning breaks without it.

| # | Change | Why | Size |
| --- | --- | --- | --- |
| 1 | **Decide the write-back default.** Option: `SIDECAR_FILE` for new users when the scan directory is writable; keep `OFF` on read-only mounts. Faces write-back also on by default. | Attribute B is otherwise a hidden setting. Run 2 showed it: on defaults LibrePhotos wrote nothing, while Immich wrote rating, description and keywords. Sidecar, not media file: in `MEDIA_FILE` mode the library job rewrote 87 of 363 originals | Small change, big decision (see open decisions) |
| 2 | **Ship 1.4.0** with caption, keyword and GPS write-back and the "Write metadata to files" job (#2690) | Released 1.3.0 covers only rating, date, rotation and faces | Release |
| 3 | **Import fidelity for digiKam, Lightroom and darktable**, tested in CI against fixture files. Measured gaps (run 2): keep keyword **hierarchies** instead of flattening them (Immich keeps them); read `digiKam:TagsList`; read Windows Photo Gallery `MP:RegionInfo` (PhotoPrism does). Already working: MWG-RS face names and boxes, flat keywords, ratings, captions, both sidecar naming styles | The "stuck" users are blocked here ([§3.3](research/01-switch-stories.md#33-stuck-they-want-it-to-work-16)); it's the front door for the best-fit user | Medium |
| 3b | **Warn when write-back is switched on for a read-only library** | Run 2: both switches were accepted on a `:ro` mount and wrote nothing, with no error to the user | Small |
| 3c | **Find what keeps 1.8 to 2.0 GB resident after indexing** (PhotoPrism idles at 0.74 GB) and cut startup (25 to 29 s, the slowest of the three) | "Runs on the box you already have" needs idle memory a NAS can spare | Medium |
| 4 | **Publish first-index numbers at 100k+** from the teardown benchmark | Indexing speed is the #1 reason people left (10 of 25 "away" stories), though from 2021-2022 versions; perf work since then (#2079 to #2083) needs public proof | Benchmark run |
| 5 | **Measure the first hour** on clean Windows, Docker and a NAS | Install trouble is the #2 reason people left (10 of 25) | Small |
| 6 | **"Create or sync album from folder"** on the Folders view | Cheapest gap; Immich rules it out (211 upvotes, [d4279](https://github.com/immich-app/immich/discussions/4279)) | Small ([issue mining §5](research/02-issue-mining.md#5-prime-differentiation-candidates)) |
| 7 | **Export proof:** export, then import into digiKam, then diff | Turns "no lock-in" from a claim into a demo | Small |
| 8 | **Mobile backup app** | Not a differentiator, but table stakes for the household; without it the "family" job stays unserved ([commoditization](research/03-trajectories.md#2-commoditization-map-wardley-style)) | Large |
| 9 | Reconsider collaborative albums ([lp#261](https://github.com/LibrePhotos/librephotos/issues/261), closed as not planned) | The #1 cross-tracker cluster is sharing, and Immich has frozen sharing ([#12614](https://github.com/immich-app/immich/issues/12614)) | Medium |

## 9. Threats to watch (from [trajectories §4](research/03-trajectories.md#4-threats-what-could-erase-a-librephotos-advantage-in-6-to-12-months))

- **Immich merges face-region XMP write-back** (medium likelihood). This erases most of B against Immich. Response: compete on import fidelity, round-trip in place (not only sidecars) and exports that carry sidecars.
- **Immich's leaner ML becomes the default** (high). This narrows D. Response: publish measured RAM, not documented minimums.
- **PhotoPrism adds names and places to its caption prompts** (medium). Captions were never a moat.
- **The big clouds make "ask your photos" table stakes** (high). This helps the local-and-free message, because their newest features are paid, 18+ and US-first ([commercial](research/03b-commercial.md)).
- **Native Windows from a competitor** (low). Attribute A is the most durable.

## 10. Evidence base and its limits

| Source | What | Main limits |
| --- | --- | --- |
| [01 switch stories](research/01-switch-stories.md) | 185 coded stories (68 about LibrePhotos), every quote verified verbatim by script | Reddit via archive mirror only, comment search failed; no Discord; homelab skew; one coder; 39 of 68 LibrePhotos stories are 2021-2022 |
| [02 issue mining](research/02-issue-mining.md) | 541 issues and discussions, 5 trackers, clustered by reactions; [CSV](research/02-issues.csv) | Reactions favour old issues; Immich requests live in Discussions; "not planned" includes stale bugs |
| [03 trajectories](research/03-trajectories.md) + [03b commercial](research/03b-commercial.md) | 12 months of releases, roadmaps, funding, claimability, threats, about 225 links | Vendor pages are vendor claims; some Adobe and Synology pages were unreachable; Microsoft event on 2026-10-20 not yet covered |
| [04 source truth](research/04-source-truth.md) | Competitor code at pinned release tags, with permalinks | Code reading, not running software. The benchmark must confirm the delete and write-back behaviour |
| [05 teardown run 2](research/05-teardown-run-2.md) (`benchmarks/teardown/`) | LibrePhotos 1.3.0 and dev, Immich, PhotoPrism on one CC0 set in GitHub Actions; indexing, RAM, interop, write-back, file safety, delete | One run each, 370 files. Immich read-only and the export check are missing (rate limit, harness bug; both fixed after the run). Nothing at large-library scale. Not yet rerun by anyone outside the project |

Spot checks repeated by hand on 2026-10-16:
- Immich FAQ, line 109: "does not modify the original files".
- Immich [#562](https://github.com/immich-app/immich/issues/562) (SQLite) closed as not planned.
- Immich [#12614](https://github.com/immich-app/immich/issues/12614) sharing feature freeze still open.
- PhotoPrism `roles.md`: User and Viewer roles require Essentials or Plus.
- LibrePhotos [#261](https://github.com/LibrePhotos/librephotos/issues/261) closed as not planned.
- Face-region writer present in the `1.3.0` tag.
- `save_metadata_to_disk` defaults to `OFF`.

## 11. Open decisions for the maintainer

1. **Write-back default** (§8 row 1). This is the biggest single lever, and the riskiest change: writing into users' files by default. A sidecar default is the safer middle ground.
2. **Accept "not for phone-first families" publicly** until the mobile app ships, or hold the positioning until it does?
3. **Category name**: "photo server for the library you already have" or something shorter. Settle it with the repeat-back test, not internally.
4. **Benchmark run 3 and a large-library profile.** Run 3 fills in Immich read-only and the export check. Merging the workflow to `dev` enables "Run workflow" and the `full` profile; a 100k-photo run needs a self-hosted runner or a longer budget.
5. **Who runs the interviews** in [`05-validation-kit.md`](05-validation-kit.md). It shouldn't be the person who wrote this doc.
