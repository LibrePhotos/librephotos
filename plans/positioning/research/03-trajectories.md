# 03 · Competitor trajectories (where each one is heading)

As of **2026-10-16**. This doc asks one question: which LibrePhotos differentiators will survive the next 6 to 12 months? It asks it about every competitor.

**Method**
- **Sources:** primary sources only.
  - GitHub releases and changelogs, pulled with `gh api`.
  - Official roadmaps, blogs, docs, pricing pages and source code.
  - Vendor marketing is labelled **[vendor claim]**. Facts read from source code are labelled **[code]**.
- **Release window:** releases published since 2025-10-01.
- **Commit window:** commits on the default branch since 2025-10-16.
  - Bots are excluded: renovate, dependabot, weblate, `*[bot]`, CI accounts and Copilot.
  - Squash-merge repos (Immich) count roughly one commit per PR. Repos with direct commits (PhotoPrism, Ente, LibrePhotos) count every commit. So **compare author counts, not commit counts.**
- **Raw data:** in [`03-raw/`](03-raw/). It holds `rel_*.jsonl` (release bodies), `commits_*.txt` (author logins), the Memories CHANGELOG, the Lychee face how-to, and Immich blog sources.

---

## 0. Snapshot: who builds what, how fast, on what money

| Project | Backer / governance | License | Human commit authors, 12 mo (all / with ≥5 commits) | Top committer's share | Releases, 12 mo | Money |
|---|---|---|---|---|---|---|
| **Immich** | FUTO pays ~10 staff; Alex Tran is BDFL ([FUTO 2 years later](https://immich.app/blog/futo-two-years-later)) | AGPL-3.0 | 317 / 35 | 11 % (jrasm91) | 11 minors (v2.1 to v3.3) + ~25 patches + RCs ([releases](https://github.com/immich-app/immich/releases)) | Optional product keys: $25 individual, $100 server, "never any paywalled features" ([product keys](https://immich.app/blog/immich-product-keys)); merch; encrypted backup product in the works ([FUTO post](https://immich.app/blog/futo-two-years-later)) |
| **PhotoPrism** | PhotoPrism UG, "100% self-funded" ([README](https://github.com/photoprism/photoprism#readme)) | AGPL-3.0 ([LICENSE](https://github.com/photoprism/photoprism/blob/develop/LICENSE)) | 13 / 6 | **92 %** (lastzero) | 7 ([releases](https://github.com/photoprism/photoprism/releases)) | Open core: Essentials and Plus memberships ([editions](https://www.photoprism.app/editions)) |
| **Ente** | Ente (company, founded 2020). "Financially independent", "not reliant on venture capital" ([open metrics post](https://ente.com/blog/open/)) | AGPL-3.0 | 154 / 42 (whole monorepo: Photos, Auth, Locker, Ensu) | 17 % | ~35 Photos app releases ([releases](https://github.com/ente/ente/releases)) | Cloud subscriptions, 10 GB free ([pricing](https://ente.com/pricing)); revenue and customer counts published monthly ([ente.com/open](https://ente.com/open)) |
| **Nextcloud Memories** | Varun Patil (pulsejet), solo ([site](https://memories.gallery/)) | AGPL-3.0 | 18 / 4 | **92 %** | ~10 stable ([CHANGELOG](https://github.com/pulsejet/memories/blob/master/CHANGELOG.md)) | None |
| **Lychee** | ildyria plus community; open core ([SE page](https://lycheeorg.dev/get-supporter-edition/)) | MIT | 21 / – | **89 %** (ildyria) | 46 ([releases](https://github.com/LycheeOrg/Lychee/releases)) | Supporter Edition €5/mo; Pro (webshop) |
| **PiGallery2** | bpatrik, hobby: "does not get paid" ([FAQ](https://bpatrik.github.io/pigallery2/faq/)) | MIT | 12 / – | **93 %** | 4, none since 2026-01-24 ([releases](https://github.com/bpatrik/pigallery2/releases)) | GitHub Sponsors |
| **Piwigo** | Pigolabs (company); the Piwigo Association is being dissolved ([announcement](https://piwigo.org/forum/viewtopic.php?id=34916)) | GPL-2.0 | 12 / – | ~32 % | 16.0 to 16.4 + 15.7 ([releases](https://github.com/Piwigo/Piwigo/releases)) | Hosted plans from €32/mo; self-host support contracts ([pricing](https://piwigo.org/pricing)) |
| **digiKam** | KDE; Gilles Caulier ([donate](https://www.digikam.org/donate/)) | GPL-2.0+ | 25 / – | **67 %** | 8.8, 9.0, 9.1; 9.2 pending ([news](https://www.digikam.org/news/2026-06-07-9.1.0_release_announcement/)) | Donations |
| **LibrePhotos** (us) | Community, no company | MIT | 27 / 11. Copilot added another 183 commits | **82 %** (derneuere) | 13: 2025w44, 2026w10 and 2026w14 ([docker repo](https://github.com/LibrePhotos/librephotos-docker/releases)), then 2026w25 and 1.0.0 to 1.3.0 ([releases](https://github.com/LibrePhotos/librephotos/releases)) | None |

**Honest read.** By contributor breadth, Immich (317 authors, ~10 paid staff) and Ente (42 regular committers, a paid team) belong to a different league. On bus factor, LibrePhotos sits with PhotoPrism, Memories, Lychee, PiGallery2 and digiKam: one person writes more than 80 % of the code. Stars, at fetch time: Immich 116k, PhotoPrism 40k, Ente 29k, LibrePhotos 8.1k, Memories 3.9k (`gh api repos/...`).

---

## 1. Per competitor

### 1.1 Immich (immich-app/immich)

**Shipped in the last 12 months, by theme**
- **ML and search**
  - OCR text search ([v2.2.0](https://github.com/immich-app/immich/releases/tag/v2.2.0)).
  - Language-specific OCR models and a text overlay in the web viewer ([v2.3.0](https://github.com/immich-app/immich/releases/tag/v2.3.0)).
  - OCR in the mobile app ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
  - PP-OCRv6 models. An opt-in `MACHINE_LEARNING_MODEL_REVISION=v2` makes ML "significantly faster and uses less memory… including CPU inference". RKNPU now runs every model, and TensorRT RTX is used ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)).
  - OpenVINO on CPU and ROCm 7.2 ([v2.6.0](https://github.com/immich-app/immich/releases/tag/v2.6.0)).
  - Search API v2 with AND/OR filters, a revamped search UI, and assets in the current map viewport ([v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0)).
  - Similar photos on mobile ([v2.2.0](https://github.com/immich-app/immich/releases/tag/v2.2.0)).
- **People and sharing**
  - Create a face on the fly in the tag editor ([v2.7.0](https://github.com/immich-app/immich/releases/tag/v2.7.0)).
  - Cross-user face clustering ("view own people in shared assets", [v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0)).
  - Shared people management with read/write access ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)). Two Immich developers write that they know of no other photo app that shares and manages recognised faces across users ([Sept recap source](https://github.com/immich-app/static-pages/blob/main/apps/root.immich.app/src/routes/(shell)/blog/(recaps)/2026-september-recap/+page.md)).
  - Birthday memories and a dedicated memories page ([v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0), [v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)).
- **Editing**
  - Non-destructive editing ([v2.5.0](https://github.com/immich-app/immich/releases/tag/v2.5.0)), extended to mobile ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
  - Mobile edits are auto-stacked ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)).
  - Star ratings on mobile ([v2.5.0](https://github.com/immich-app/immich/releases/tag/v2.5.0)).
- **Automation**
  - Workflows and plugins preview: triggers, filters and actions in a drag-and-drop or JSON builder ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
  - A tags trigger ([v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0)) and a filter by server file path ([v3.1.0](https://github.com/immich-app/immich/releases/tag/v3.1.0)).
- **Mobile and backup**
  - Android delete sync ([v2.3.0](https://github.com/immich-app/immich/releases/tag/v2.3.0)) and Free Up Space ([v2.5.0](https://github.com/immich-app/immich/releases/tag/v2.5.0)).
  - Better background backup, and Immich can be opened as the Android gallery ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
- **Operations**
  - Database backup and restore in the web UI ([v2.5.0](https://github.com/immich-app/immich/releases/tag/v2.5.0)).
  - Integrity checks, release candidates, and an HLS / real-time transcoding preview ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
  - A Docker compose builder ([v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0)).
- **Auth**
  - Profile claims read from the ID token ([v2.6.0](https://github.com/immich-app/immich/releases/tag/v2.6.0)).
  - OIDC role-claim sync ([v3.1.0](https://github.com/immich-app/immich/releases/tag/v3.1.0)) and claim sync on every login ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)).
- **Breaking changes**
  - v3 drops pgvecto.rs ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)).
  - ML on amd64 needs x86-64-v2 ([v2.7.0](https://github.com/immich-app/immich/releases/tag/v2.7.0)).

**Announced next**
- **Roadmap items marked "Soon™":** Better sharing, User groups, Chunked uploads, **Automatic stacking**, **Smart memories**, **Smart albums**, **iCloud import**, Reverse geocoding v2 ([roadmap](https://immich.app/roadmap)).
- **September recap:** the focus is still better sharing, plus a "PostgreSQL 18/19 migration" ([source](https://github.com/immich-app/static-pages/blob/main/apps/root.immich.app/src/routes/(shell)/blog/(recaps)/2026-september-recap/+page.md)).
- **Paid services:** "we're also working on an encrypted backup product" ([FUTO 2 years later](https://immich.app/blog/futo-two-years-later)). The stable-release post says paid services are "not paywalled features" ([stable release](https://immich.app/blog/stable-release)).
- **Signal about face write-back to XMP:** two community PRs that write faces to XMP were closed unmerged:
  - [#27870](https://github.com/immich-app/immich/pull/27870), June 2026: the author stopped working on it.
  - [#30704](https://github.com/immich-app/immich/pull/30704), August 2026: a maintainer said it was not closed "because of the specific approach". The submitter believes it was closed for being AI-assisted.

  The demand exists, and the feature is one maintainer decision away.

**Business model:** AGPL. Optional lifetime keys at $25 per user or $100 per server. "No, there will never be any paywalled features" ([product keys](https://immich.app/blog/immich-product-keys)). Immich holds registered trademarks ([FUTO post](https://immich.app/blog/futo-two-years-later)).

**Governance:** owned by FUTO. Three people went full-time in May 2024; now "~10 people". Alex remains BDFL ([FUTO post](https://immich.app/blog/futo-two-years-later)).

**Platforms**
- **Docker is required:** "Immich requires Docker with the Docker Compose plugin" ([requirements](https://docs.immich.app/install/requirements)).
- **Linux is recommended.** Windows works only through Docker Desktop or WSL2, and the database "will not work on any filesystem formatted in NTFS" ([requirements](https://docs.immich.app/install/requirements)).
- amd64 and arm64.
- **RAM: "Minimum 6GB, recommended 8GB"**. Two cores minimum, four recommended ([requirements](https://docs.immich.app/install/requirements)).

### 1.2 PhotoPrism (photoprism/photoprism)

**Shipped in the last 12 months**
- **AI**
  - Captions and labels through Ollama (local) or the OpenAI API (cloud), a new CNN face engine, and background scheduling of vision models ([251130](https://github.com/photoprism/photoprism/releases/tag/251130-b3068414c)).
  - ONNX face detection replaces Pigo ([260523](https://github.com/photoprism/photoprism/releases/tag/260523-0544f71c1)).
  - New face detection and embedding models ([260919](https://github.com/photoprism/photoprism/releases/tag/260919-28c46a116)).
  - ONNX classification and NSFW models, ONNX on NVIDIA GPUs, and automatic naming of new face clusters ([261007](https://github.com/photoprism/photoprism/releases/tag/261007-65faaae5d)).
  - A read-only MCP server ([260523](https://github.com/photoprism/photoprism/releases/tag/260523-0544f71c1)).
- **Editing:** a Batch Edit dialog ([251130](https://github.com/photoprism/photoprism/releases/tag/251130-b3068414c)) and manual face tagging in the viewer ([260523](https://github.com/photoprism/photoprism/releases/tag/260523-0544f71c1)).
- **Metadata, read side only**
  - Face regions imported from XMP sidecars and from embedded XMP.
  - GPS read from XMP sidecars.
  - Camera and lens fields editable through the CLI and API.
  - All in [260728](https://github.com/photoprism/photoprism/releases/tag/260728-bbde8f452).
- **Media**
  - 360° photos and videos and an inline PDF viewer ([260728](https://github.com/photoprism/photoprism/releases/tag/260728-bbde8f452)).
  - Insta360 support ([260919](https://github.com/photoprism/photoprism/releases/tag/260919-28c46a116), [261007](https://github.com/photoprism/photoprism/releases/tag/261007-65faaae5d)).
  - Vulkan transcoding ([260523](https://github.com/photoprism/photoprism/releases/tag/260523-0544f71c1)).
- **Auth:** an OIDC sign-in prompt and RP-initiated logout ([260728](https://github.com/photoprism/photoprism/releases/tag/260728-bbde8f452)).
- **UI:** Vuetify 4 ([261007](https://github.com/photoprism/photoprism/releases/tag/261007-65faaae5d)) and MapLibre v6 ([260919](https://github.com/photoprism/photoprism/releases/tag/260919-28c46a116)).

**Announced next.** The roadmap board is [github.com/orgs/photoprism/projects/5](https://github.com/orgs/photoprism/projects/5), which our token cannot read. These are the open `priority` issues:
- Multi-user / multi-library, labelled **in-progress** ([#98](https://github.com/photoprism/photoprism/issues/98)).
- Memories, "today x years ago" ([#720](https://github.com/photoprism/photoprism/issues/720)).
- A timeline view ([#152](https://github.com/photoprism/photoprism/issues/152)).
- **Embed XMP metadata in JPEG files**, labelled needs-analysis ([#243](https://github.com/photoprism/photoprism/issues/243)).
- **Write metadata to XMP sidecars or EXIF**, labelled idea ([#402](https://github.com/photoprism/photoprism/issues/402)).
- Cloud storage with encryption ([#93](https://github.com/photoprism/photoprism/issues/93)).

Other issues to watch:
- **CLIP semantic search** is still labelled `idea` ([#1287](https://github.com/photoprism/photoprism/issues/1287)). The maintainer added acceptance criteria in November 2025, and a Qdrant vector DB already sits in the dev compose stack, in a commit citing #1287 ([aa687ade0](https://github.com/photoprism/photoprism/commit/aa687ade0), March 2025).
- TensorFlow removal ([#5890](https://github.com/photoprism/photoprism/issues/5890)).

**Business model [vendor claim]**
- **Community Edition:** free and AGPL.
- **Paid tiers:** Essentials at about €2/mo and Plus from about €6/mo, billed annually. The page's own figures are inconsistent ([editions](https://www.photoprism.app/editions)).
- **Paid-only features:**
  - 3D vector and satellite maps.
  - Geocoding without a rate limit.
  - Extra User and Viewer roles.
  - The user-management UI and admin web UI (Plus).
- **OIDC** works in Community. Only "a higher authorization level by default" for new OIDC accounts is Pro ([OIDC docs](https://docs.photoprism.app/getting-started/advanced/openid-connect/)).

**Governance:** PhotoPrism UG. One maintainer writes 92 % of commits; 13 human accounts.

**Platforms**
- Docker on Mac, Linux and Windows, the Windows case through Docker Desktop. Linux packages for "experienced users". FreeBSD, Raspberry Pi and NAS devices.
- 64-bit only.
- **"3 GB of physical memory", 2 cores, 4 GB swap** ([getting started](https://docs.photoprism.app/getting-started/)).
- No native Windows build is documented.

### 1.3 Ente (ente/ente, formerly ente-io/ente)

**Shipped in the last 12 months.** All of this is Photos unless noted.
- **On-device ML**
  - OCR text selection ([photos-v1.2.15](https://github.com/ente/ente/releases/tag/photos-v1.2.15)).
  - Text and QR detection on long-press, and Memory Lane ([v1.3.32](https://github.com/ente/ente/releases/tag/photos-v1.3.32)).
  - A QR Codes section ([v1.3.40](https://github.com/ente/ente/releases/tag/photos-v1.3.40)).
  - Manual people tagging ([v1.2.31](https://github.com/ente/ente/releases/tag/photos-v1.2.31)).
  - "ML runs on the GPU", about 10x faster on mobile and desktop ([blog](https://ente.com/blog/ml-on-gpu/)).
- **Social**
  - Comments, reactions and album admins ([v1.3.0](https://github.com/ente/ente/releases/tag/photos-v1.3.0)).
  - Public links on the free plan ([v1.2.31](https://github.com/ente/ente/releases/tag/photos-v1.2.31)).
  - Embeddable albums and a map view for shared links ([v1.2.11](https://github.com/ente/ente/releases/tag/photos-v1.2.11)).
  - Comments on shared memories ([v1.3.59](https://github.com/ente/ente/releases/tag/photos-v1.3.59)).
  - **Library Sharing** with family ([v1.3.63](https://github.com/ente/ente/releases/tag/photos-v1.3.63)).
- **Gallery**
  - An offline mode with no sign-up ([v1.3.22](https://github.com/ente/ente/releases/tag/photos-v1.3.22)).
  - Use as the Android gallery ([v1.3.44](https://github.com/ente/ente/releases/tag/photos-v1.3.44)).
  - Device deletes go to the system trash on Android 11+, and edits keep camera, date and location data ([v1.3.63](https://github.com/ente/ente/releases/tag/photos-v1.3.63)).
- **New products**
  - Locker, a document vault ([locker-v1.0.0](https://github.com/ente/ente/releases/tag/locker-v1.0.0)).
  - **Ensu**, a local-LLM app ([ensu-v0.1.3](https://github.com/ente/ente/releases/tag/ensu-v0.1.3)). It now has RAG and knowledge packs ([ensu-v0.1.21](https://github.com/ente/ente/releases/tag/ensu-v0.1.21)).
- **Self-host tooling:** CLI export `--exclude-albums` and `admin send-mail` ([cli-v0.3.0](https://github.com/ente/ente/releases/tag/cli-v0.3.0)).
- **Company moves**
  - Domain moved to ente.com ([blog](https://ente.com/blog/ente-dot-com/)).
  - GitHub org renamed to `ente` ([blog](https://ente.com/blog/ente-ente/)).
  - Business metrics made public ([blog](https://ente.com/blog/open/)).
  - A CERN-sponsored Cure53 audit, listed 2025-11-03 ([blog index](https://ente.com/blog)).

**Announced next.** We found no public Photos roadmap.
- The ML post says "The Rust rewrite continues" ([blog](https://ente.com/blog/ml-on-gpu/)).
- "All AI is not the same" concedes that on-device AI "cannot yet match" Google's Ask Photos ([blog](https://ente.com/blog/all-ai-is-not-the-same/)).
- **Watch:** Ensu, Ente's local LLM and RAG stack, is the obvious path to natural-language "ask your photos". It is not announced for Photos.

**Business model [vendor claim]** ([pricing](https://ente.com/pricing))
- Free 10 GB, "free forever", including on-device AI, sharing and public links.
- Paid: 50 GB $2.49, 200 GB $4.99, 1 TB $9.99 and 2 TB $19.99 per month.
- Family plan, 3 replicas and human support are paid-only.
- Self-hosting is the "same code we use on production", with no licence key mentioned ([self-hosting](https://ente.com/help/self-hosting/)).
- **Published metrics [vendor claim]** ([ente.com/open](https://ente.com/open); raw HTML saved in `03-raw/ente_open.html`). Each 2026 chart runs from January to the latest point:

  | Metric | Jan 2026 | Latest point |
  |---|---|---|
  | Annual revenue | $780,996 | $1,413,012 |
  | Paying customers | 12,018 | 21,807 |
  | Registered accounts | 290,703 | 490,639 |

  The page has Annual, Monthly and Yearly toggles, and the extracted text does not say which one the default view shows, or the month of the latest point. Ente is growing fast on revenue alone, which shows the privacy-cloud model works.

**Platforms**
- **Server:** Docker Compose, "at least 1 GB of RAM and 1 CPU core" ([self-hosting](https://ente.com/help/self-hosting/)).
- **ML runs only on clients:** "All machine learning happens entirely on your device" ([ML help](https://ente.com/help/photos/features/search-and-discovery/machine-learning)). Phones and the desktop app (Windows, macOS, Linux) do the indexing.
- So an Ente server is cheap, but every client spends its own battery and RAM.
- **Not a folder manager.** Files are end-to-end encrypted uploads. Export is a desktop "Export Data" with continuous sync ([export help](https://ente.com/help/photos/migration/export/)).

### 1.4 Nextcloud Memories (pulsejet/memories)

**Shipped in the last 12 months** ([CHANGELOG](https://github.com/pulsejet/memories/blob/master/CHANGELOG.md))
- **[v7.8.0](https://github.com/pulsejet/memories/releases/tag/v7.8.0):** uploads to public shares and folder download links.
- **[v8.0.0](https://github.com/pulsejet/memories/releases/tag/v8.0.0) and [v8.1.0](https://github.com/pulsejet/memories/releases/tag/v8.1.0):** Nextcloud 33 and 34 compatibility, and "on this day" settings.
- **[v9.0.0](https://github.com/pulsejet/memories/releases/tag/v9.0.0) (Sep 2026)**
  - Nextcloud 34+ required.
  - A redesigned mobile viewer, video zoom, and storyboard previews on hover.
  - Huawei moving pictures.
  - A configurable geocoding provider and a selectable map tile server.
  - Android: geolocation and upload of selected local photos.
- **[v10.0.0](https://github.com/pulsejet/memories/releases/tag/v10.0.0) (Oct 2026)**
  - PhotoSphere panoramas.
  - Transcoding for external and object storage, with several transcoders.
  - Resumable downloads and a metadata refresh.
- **[v10.1.0](https://github.com/pulsejet/memories/releases/tag/v10.1.0):** live-photo editing works on a copy, and a per-user setting shows filenames.

**Announced next:** nothing formal. v10 warns that the next Android app breaks compatibility with older servers ([CHANGELOG](https://github.com/pulsejet/memories/blob/master/CHANGELOG.md)).

**Business and governance:** free, AGPL, one maintainer (92 % of commits).

**Faces:** come from Nextcloud's Recognize or Face Recognition apps ([site](https://memories.gallery/)). Recognize v13 can send processing to a separate machine via AppAPI ([recognize v13.0.0](https://github.com/nextcloud/recognize/releases/tag/v13.0.0)).

**Platforms**
- Wherever Nextcloud runs, which means Linux servers only. "Windows 10+" is listed only for the desktop client ([NC requirements](https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html)).
- Nextcloud asks for 128 MB minimum and 512 MB recommended per PHP process.

**Metadata:** edits go straight into the original file with `exiftool -overwrite_original_in_place` ([lib/Exif.php](https://github.com/pulsejet/memories/blob/master/lib/Exif.php)) **[code]**. Folders stay the source of truth ([site](https://memories.gallery/)).

### 1.5 Lychee (LycheeOrg/Lychee)

**Shipped in the last 12 months**
- **Platform:** FrankenPHP/Octane, PHP 8.4, worker mode and AVIF ([v7.0.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.0.0)); Laravel 13 and OpenTelemetry ([v7.11.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.11.0)).
- **Faces (Feature 030)**
  - A Python sidecar using DeepFace with ArcFace and RetinaFace on TensorFlow ([Lychee-Facial-Recognition](https://github.com/LycheeOrg/Lychee-Facial-Recognition)).
  - Merged 2026-06-21 ([#4280](https://github.com/LycheeOrg/Lychee/pull/4280)); `git compare` shows it ships from v7.6.1.
  - Face quick-naming merged 2026-10-15 ([#4886](https://github.com/LycheeOrg/Lychee/pull/4886)).
- **Write-back:** opt-in write of title, description, tags and rating into originals ([v7.8.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.8.0), [spec 059](https://github.com/LycheeOrg/Lychee/blob/master/docs/specs/4-architecture/features/059-embed-metadata-in-file/spec.md)). It does not write GPS, dates or faces.
- **Auth:** Kanidm ([v7.9.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.9.0)) and Pocket ID ([v7.11.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.11.0)) OAuth providers. LDAP is SE only ([v7.3.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.3.0)).
- **Commerce:** a webshop ([v7.6.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.6.0)), white-label, and a contact form ([v7.4.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.4.0)).

**Announced next.** Lychee publishes numbered feature specs 001–093 and a [roadmap.md](https://github.com/LycheeOrg/Lychee/blob/master/docs/specs/4-architecture/roadmap.md).
- **In testing:** 360° photos (082), library insights (085), album map header (086), NSFW review (089) and email login (091).
- **Ongoing:** the v8 frontend migration to Nuxt UI (049).
- **There are no CLIP, OCR or captioning specs.**

**The faces paywall is ambiguous.**
- **Docs say paid:** the spec and how-to call the settings "only visible on Supporter Edition instances" ([how-to](https://github.com/LycheeOrg/Lychee/blob/master/docs/specs/2-how-to/configure-facial-recognition.md)).
- **Code says free:** the routes are gated only by `feature:ai-vision` and `feature:v8` ([routes/api_v2.php#L422](https://github.com/LycheeOrg/Lychee/blob/8bf3f2815d153fe43b679e6698119575a1959c65/routes/api_v2.php#L422)) **[code]**.
- The SE page lists faces on the Free card ([SE page](https://lycheeorg.dev/get-supporter-edition/)).
- Faces need the v8 flag, which is off by default ([config/features.php](https://github.com/LycheeOrg/Lychee/blob/8bf3f2815d153fe43b679e6698119575a1959c65/config/features.php)).
- NSFW detection *is* SE-only ([routes L474](https://github.com/LycheeOrg/Lychee/blob/8bf3f2815d153fe43b679e6698119575a1959c65/routes/api_v2.php#L474)).

**Business model:** Supporter Edition €5/mo through keygen licensing. SE-only features include statistics, user groups, quotas, watermarking and LDAP. Pro covers the webshop ([SE page](https://lycheeorg.dev/get-supporter-edition/), [v7 blog](https://lycheeorg.dev/2025-12-31-version-7/)).

**Platforms**
- PHP 8.4 with a DB. No RAM figure. Windows is not mentioned ([manual install](https://lycheeorg.dev/docs/getting-started/manual-installation/)).
- Docker for amd64 and arm64.

### 1.6 PiGallery2 (bpatrik/pigallery2)

**Shipped in the last 12 months**
- **[3.0.0](https://github.com/bpatrik/pigallery2/releases/tag/3.0.0):** extensions, projected galleries per user, **XMP sidecar reading**, and HEIC/RAW. armv7 is dropped on the Debian image.
- **[3.1.0](https://github.com/bpatrik/pigallery2/releases/tag/3.1.0):** a photo-frame mode.
- **[3.5.2](https://github.com/bpatrik/pigallery2/releases/tag/3.5.2):** OIDC (the release notes call it "ORCID", [#1096](https://github.com/bpatrik/pigallery2/issues/1096)), file upload, and a new search language. It breaks the existing DB and config.
- **Unreleased on master:** live photos and login hardening ([commits](https://github.com/bpatrik/pigallery2/commits/master)).

**Announced next:** the "Next (probably v4.0)" milestone holds mostly sharing and search bugs, with no AI ([milestones](https://github.com/bpatrik/pigallery2/milestones)).

**Positioning:** "the disk is the source of truth and the database is only a cache" ([FAQ](https://bpatrik.github.io/pigallery2/faq/)).
- It never writes metadata.
- Faces come only from existing XMP regions; it does no ML of its own ([features](https://bpatrik.github.io/pigallery2/features/)).

**Platforms:** Docker on amd64, arm64 and armv7 (Alpine). The direct install is "unsupported", and Windows is not documented ([direct install](https://bpatrik.github.io/pigallery2/setup/direct-install/)).

### 1.7 Piwigo (Piwigo/Piwigo + Pigolabs)

**Shipped in the last 12 months**
- **[16.0.0](https://piwigo.org/release-16.0.0):** per-user API keys, TOTP 2FA, an expert search syntax, batch file replacement, and an **official Docker image**.
- **16.1 to 16.4:** security work. [16.4.0](https://piwigo.org/release-16.4.0) fixed 7 GHSAs.
- **Piwigo AI plugin**, 0.0.7-beta on 2026-10-05: descriptions, tags, OCR and embeddings, all **processed on Pigolabs servers at OVH** rather than locally ([extension](https://piwigo.org/ext/index.php?eid=1070), [README](https://github.com/Piwigo/piwigo-ai)).
- **Mobile:** iOS app releases v4.1 to v4.4.2 ([Piwigo-Mobile](https://github.com/Piwigo/Piwigo-Mobile/releases)).
- **Organisation:** piwigo.com merged into piwigo.org ([announcement](https://piwigo.org/forum/viewtopic.php?id=34916)).

**Announced next:** milestone 17.0.0beta1 includes **core people management** meant to feed Piwigo AI face recognition ([#2560](https://github.com/Piwigo/Piwigo/issues/2560)). The AI plugin's embeddings are intended "later for similar photos and natural-language search" ([README](https://github.com/Piwigo/piwigo-ai)).

**Business model [vendor claim]:** hosted plans from €32 to €439 per month ([pricing](https://piwigo.org/pricing)).
- AI auto-tagging and smart albums need Enterprise (€219) or higher.
- **SSO is VIP-only (€439).**
- Self-hosted software is free. Self-hosted OIDC is a 2021-era community plugin ([ext 918](https://piwigo.org/ext/index.php?eid=918)).

**Platforms:** PHP and MySQL. Docker image for amd64 and arm64 ([requirements](https://doc.piwigo.org/self-hosting-piwigo/install-guides/requirements/)).

### 1.8 digiKam (KDE, desktop)

**Shipped in the last 12 months**
- **[8.8.0](https://www.digikam.org/news/2025-10-19-8.8.0_release_announcement/):** Qt 6.10, Windows long paths, and tag hierarchy import/export.
- **[9.0.0](https://www.digikam.org/news/2026-03-08-9.0.0_release_announcement/):** bulk GPS editing, a Survey tool, and faster face operations.
- **[9.1.0](https://www.digikam.org/news/2026-06-07-9.1.0_release_announcement/):** Pixel motion photos, time zones, and a MariaDB migration tool.

**Announced next.** digiKam 9.2 brings a **local LLM natural-language search**: Qwen2.5-1.5B through llama.cpp, a ~1.1 GB optional download ([announcement](https://www.digikam.org/news/2026-08-20-advanced_search_improvements_with_llm/), [quick start](https://docs.digikam.org/en/getting_started/quick_start.html), [GSoC report](https://community.kde.org/GSoC/2026/StatusReports/SrirupaDatta)).
- It translates text into search filters. It does not search image embeddings.
- The 9.1 notes also promise OpenCV 5 and "AI-powered tools".

**Existing AI:** auto-tags with EfficientNet or YOLOv11 ([docs](https://docs.digikam.org/en/maintenance_tools/maintenance_autotags.html)), an image quality scanner, and faces ([docs](https://docs.digikam.org/en/maintenance_tools/maintenance_faces.html)).

**Metadata write-back is the reference standard.** digiKam writes tags, captions, ratings, labels, dates, GPS and face rectangles to files and/or XMP sidecars ([metadata settings](https://docs.digikam.org/en/setup_application/metadata_settings.html)).

**Platforms**
- Native Windows 10+ x64, macOS (Apple Silicon and Intel), and a Linux x86-64 AppImage. **No Linux aarch64 or Windows ARM64** ([download](https://www.digikam.org/download/)).
- **4 GB RAM minimum; 16 GB and 8 cores for AI features** ([install docs](https://docs.digikam.org/en/getting_started/installation.html)).
- It is a desktop app: no server, no multi-user, no web or mobile access.

### 1.9 Synology Photos (NAS package)

**Shipped in the last 12 months** ([release notes JSON](https://www.synology.com/api/releaseNote/findChangeLog?identify=SynologyPhotos&lang=en-global), saved in `03-raw/syno_photos.json`)
- **1.8.2:** similar-photo and upload fixes (2025-10 and 2025-11). The 2025-10-08 build was recalled.
- **1.9.0 (2026-04-21):** favorites, AV1 playback, and the date taken read from IPTC/XMP.
- **1.9.1 (2026-07-07):** fixes.
- **DSM:** 7.3 (2025-10-08), 7.4 (2026-06-16) and 7.4.1 (2026-07-23) ([DSM release notes JSON](https://www.synology.com/api/releaseNote/findChangeLog?identify=DSM&lang=en-global)).

**Trajectory: slow.** Two feature releases in 12 months, and no semantic search, OCR or captioning.

**Capabilities [vendor claim]** ([DSM 7.4 spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos))
- Faces and objects: "supported only on certain Synology NAS models to ensure system performance."
- Similar-photo stacking, a folder view, a mobile backup app, and metadata editing of dates, descriptions, tags and ratings. The spec does not say whether edits are written to the files.
- SSO is not mentioned.
- Business model: hardware sales; the package is free on a Synology NAS.

### 1.10 Google Photos

**Shipped in the last 12 months** ([blog RSS](https://blog.google/products-and-platforms/products/photos/rss/), saved in `03-raw/gphotos_rss.xml`)
- **Nov 2025:** "Help me edit" personalised edits, conversational editing on iOS, Nano Banana restyling, AI templates, and an "Ask" button. **Ask Photos expanded to "more than 100 new countries and regions, and 17 new languages"** ([blog](https://blog.google/products-and-platforms/products/photos/nano-banana-ai-templates-ask-photos/)).
- **Dec 2025:** video editor templates ([blog](https://blog.google/products-and-platforms/products/photos/new-video-editor-templates-custom-text/)) and the 2025 Recap ([blog](https://blog.google/products-and-platforms/products/photos/google-photos-2025-recap/)).
- **Feb 2026:** Ask Photos tips ([blog](https://blog.google/products-and-platforms/products/photos/ask-button-ask-photos-tips/)).
- **Apr 2026:** touch-up tools ([blog](https://blog.google/products-and-platforms/products/photos/new-touch-up-tools-google-photos/)) and Wardrobe ([blog](https://blog.google/products-and-platforms/products/photos/google-photos-wardrobe-feature/)).
- **Jul 2026:** Video Remix ([blog](https://blog.google/products-and-platforms/products/photos/video-remix/)).
- **Sep 2026:** Gemini portrait editing ("Available to eligible Google AI Pro and Ultra subscribers in the U.S."), Moods, Remix templates and markup ([blog](https://blog.google/products-and-platforms/products/photos/google-photos-updates/)).

**Direction.** Gemini is moving deeper into Photos, and the newest features are gated by paid AI plan, by region and by age (18+) ([Sept 2026](https://blog.google/products-and-platforms/products/photos/google-photos-updates/), [Nov 2025](https://blog.google/products-and-platforms/products/photos/nano-banana-ai-templates-ask-photos/)).

**Pricing [vendor claim]** ([plans, EU view](https://one.google.com/about/plans))
- 15 GB free.
- Basic 100 GB at €1.99/mo.
- AI Plus 2 TB at €9.99/mo.
- AI Pro 5 TB at €21.99/mo.

Since June 2021, every upload counts toward storage ([help](https://support.google.com/photos/answer/6220791)).

**Lock-in.** Google's help does not describe embedding edits into exported files. The common observation that Takeout puts metadata in per-file JSON sidecars could not be verified from a Google page in this session.

### 1.11 Apple Photos / iCloud Photos

**Shipped or announced**
- iOS 27 brings enhanced Clean Up, **Extend**, and **Spatial Reframing**.
- Its footnote says features that "rely on server-side models are subject to daily usage limits" and names Intelligent Photo Editing Tools among them ([apple.com/ios](https://www.apple.com/ios/)).

**ML location [vendor claim]:** "Face recognition and scene and object detection are done completely on your device rather than in the cloud" ([privacy features](https://www.apple.com/privacy/features/)).

**Pricing [vendor claim]:** iCloud+ costs 50 GB $0.99, 200 GB $2.99, 2 TB $9.99, 6 TB $29.99 and 12 TB $59.99 per month ([iCloud](https://www.apple.com/icloud/)).

**Export:** Photos for Mac can "Export Unmodified Original" with "Export IPTC as XMP". Faces and ratings are not mentioned ([support](https://support.apple.com/guide/photos/export-photos-videos-and-slideshows-pht6e157c5f/mac)).

### 1.12 Amazon Photos

- **Storage [vendor claim]:** Prime gets unlimited high-resolution photos plus "up to 5 GB of video storage". Paid video add-ons cost $0.99 to $11.99 per month.
- **Recent changes [vendor claim]:** a redesigned app that puts memories first, and "Prime members can find any photo by describing it in plain language" ([About Amazon](https://www.aboutamazon.com/news/amazon-prime/how-to-use-amazon-photos-storage); the page is undated).
- **Business model:** photos are a Prime retention perk.

### 1.13 Microsoft OneDrive Photos

**We found no primary source in this session.** The OneDrive Tech Community blog showed only April to September 2026 posts, and none of them was about photos ([blog](https://techcommunity.microsoft.com/category/onedrive/blog/onedriveblog)).

**Secondary reports (not primary; listed only so we watch them):** an October 2025 announcement of a "Photos Agent" for natural-language photo search, limited to Microsoft 365 Premium or Copilot, and a new Windows app with face grouping ([Thurrott](https://www.thurrott.com/cloud/328079/onedrive-is-getting-new-copilot-features-photos-agent-more)).

**Next:** a "OneDrive + Copilot Digital Event" on 2026-10-20 ([Tech Community](https://techcommunity.microsoft.com/blog/onedriveblog/save-the-date-join-us-october-20-for-the-onedrive--copilot-digital-event/4556814)). **Re-check after it.**

### 1.14 Adobe Lightroom / Lightroom Classic

**Pricing [vendor claim]** ([plans](https://www.adobe.com/products/photoshop-lightroom/plans.html))

| Plan | Price | Storage | Generative credits |
|---|---|---|---|
| Lightroom | $11.99/mo | 1 TB | 250 |
| Photography | $19.99/mo | 1 TB | 1,000 |

Both include Lightroom Classic.

**What's new:** Adobe's help pages returned HTTP 403 to our fetcher, so we did not verify Lightroom's release list this session. Adobe MAX 2026 coverage did not appear in Adobe's newsroom either ([newsroom](https://news.adobe.com/)).

**Positioning.** Lightroom Classic is a native Windows and macOS catalog over your own folders, with XMP sidecar writing. That is long-standing behaviour, but we did not re-verify it this session because helpx was blocked. It is the paid, desktop, single-user version of differentiators (a), (b) and (c).

### 1.15 LibrePhotos (baseline for an honest comparison)

**Shipped in the last 12 months**
- **[2026w10](https://github.com/LibrePhotos/librephotos-docker/releases/tag/2026w10):** stacks and file variants, duplicate detection, UUID primary keys, per-album public sharing controls, slideshow, Explore page, Spotlight search, and SigLIP 2 tagging.
- **[2026w14](https://github.com/LibrePhotos/librephotos-docker/releases/tag/2026w14):** **face tags written back to XMP-MWG-RS sidecars**, a server log viewer, and a services health panel.
- **[2026w25](https://github.com/LibrePhotos/librephotos/releases/tag/2026w25):** monorepo, and InsightFace/ArcFace on ONNX in place of dlib.
- **[1.1.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.1.0):** **OIDC SSO** through allauth; **screenshot and document categories with OCR search and live text**; date edits now actually written (`XMP:DateCreated`).
- **[1.2.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.2.0)**
  - **A standalone Windows build with no Docker.**
  - **Every model on ONNX Runtime; PyTorch removed.**
  - **LFM2.5-VL captions "prompted with the people and places in the photo".**
  - Memories, and faster scans.
- **[1.3.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.3.0):** OpenCLIP ViT-B/32 (MIT) for tags and search; less memory; a timeline filter; videos that play in every browser; thumbnails stripped of EXIF/GPS; and security fixes.
- **On dev, unreleased:** a "Write metadata to files" job (#2690, commit `9f71dd425`).

**Platforms**
- Docker on x86 or ARM64, "recommended to have 4GBs of RAM" ([standard install](https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/docs/installation/standard-install.md)).
- The Windows x64 standalone zip ([windows standalone](https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/docs/installation/windows-standalone.md)).
- The captioner needs "about 0.9 GB of RAM while it captions" ([captioning docs](https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/docs/user-guide/image-captioning.md)).

**Write-back coverage [code]**
- Dates go to `XMP:DateCreated`; GPS to `XMP-exif:GPSLatitude` in sidecars and `GPS:` tags in files; descriptions to `XMP:Description`; keywords and person names to `XMP:Subject` / `IPTC:Keywords`; face regions to `XMP-mwg-rs:RegionInfo`.
- Rating is an edit field.
- Sources: [tags.py](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/api/metadata/tags.py), [photo_writer.py](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/api/metadata/photo_writer.py), [face_regions.py](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/api/metadata/face_regions.py) and [edits.py](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/api/metadata/edits.py).

**Weak spots to be honest about**
- **No mobile app has shipped.** "There is no build on the Google Play Store, the App Store, F-Droid or TestFlight" ([apps/mobile/README.md](https://github.com/LibrePhotos/librephotos/blob/dev/apps/mobile/README.md)).
- **One maintainer writes 82 % of the code.**
- We have no paid staff and roughly a fourteenth of Immich's stars.
- Bulk captioning is still marked "Not released yet" in the docs.

---

## 2. Commoditization map (Wardley-style)

**Stages**
- **Commodity:** most serious tools ship it, so users expect it. It cannot carry positioning.
- **Product:** several ship it; you can compete on quality.
- **Custom:** one or two ship it.
- **Genesis:** new or experimental.

| Capability | Stage | Who has it (evidence) | Who lacks it |
|---|---|---|---|
| **Face detection, clustering and naming** | Commodity | Immich ([docs](https://docs.immich.app/features/facial-recognition)), PhotoPrism ([docs](https://docs.photoprism.app/user-guide/ai/face-recognition/)), Ente ([help](https://ente.com/help/photos/features/search-and-discovery/machine-learning)), Memories via Recognize ([site](https://memories.gallery/)), Lychee from v7.6.1 ([#4280](https://github.com/LycheeOrg/Lychee/pull/4280)), digiKam ([docs](https://docs.digikam.org/en/maintenance_tools/maintenance_faces.html)), Synology ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)), Apple ([privacy](https://www.apple.com/privacy/features/)), LibrePhotos ([2026w25](https://github.com/LibrePhotos/librephotos/releases/tag/2026w25)) | PiGallery2 (reads XMP regions only, [features](https://bpatrik.github.io/pigallery2/features/)); Piwigo (planned, [#2560](https://github.com/Piwigo/Piwigo/issues/2560)) |
| **Map with reverse geocoding** | Commodity | Every tool reviewed. PhotoPrism puts its better maps and unlimited geocoding behind a paywall ([editions](https://www.photoprism.app/editions)) | – |
| **Natural-language (CLIP-style) search** | Commodity among the leaders | Immich ([docs](https://docs.immich.app/features/searching)), Ente ([help](https://ente.com/help/photos/features/search-and-discovery/machine-learning)), Google Ask Photos ([blog](https://blog.google/products-and-platforms/products/photos/nano-banana-ai-templates-ask-photos/)), Amazon ([About Amazon](https://www.aboutamazon.com/news/amazon-prime/how-to-use-amazon-photos-storage)), LibrePhotos ([1.3.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.3.0)) | PhotoPrism (`idea`, [#1287](https://github.com/photoprism/photoprism/issues/1287)), Memories, Lychee, PiGallery2, Synology, Piwigo (cloud embeddings planned, [README](https://github.com/Piwigo/piwigo-ai)), digiKam (its 9.2 LLM turns text into filters, [post](https://www.digikam.org/news/2026-08-20-advanced_search_improvements_with_llm/)) |
| **Mobile auto-backup app** | Commodity | Immich ([docs](https://docs.immich.app/features/mobile-backup)), Ente, Memories (Nextcloud apps, [site](https://memories.gallery/)), Synology ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)), Google, Apple, Amazon | **LibrePhotos** (not released, [README](https://github.com/LibrePhotos/librephotos/blob/dev/apps/mobile/README.md)), PhotoPrism (recommends third-party PhotoSync, [docs](https://docs.photoprism.app/user-guide/sync/mobile-devices/)), Lychee, PiGallery2, digiKam |
| **OIDC SSO, free** | Commodity in self-hosting | Immich ([docs](https://docs.immich.app/administration/oauth)), PhotoPrism Community ([docs](https://docs.photoprism.app/getting-started/advanced/openid-connect/)), PiGallery2 ([3.5.2](https://github.com/bpatrik/pigallery2/releases/tag/3.5.2)), Lychee (named providers only, [enum](https://github.com/LycheeOrg/Lychee/blob/master/app/Enum/OauthProvidersType.php)), Memories via Nextcloud [user_oidc](https://github.com/nextcloud/user_oidc), LibrePhotos ([1.1.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.1.0)) | Ente (no OIDC found; login uses password, passkey or email OTP, [cli-v0.3.0](https://github.com/ente/ente/releases/tag/cli-v0.3.0)); Piwigo (VIP hosted plan only, [pricing](https://piwigo.org/pricing)) |
| **"On this day" memories** | Commodity | Immich ([v3.2.0](https://github.com/immich-app/immich/releases/tag/v3.2.0)), Ente ([v1.3.40](https://github.com/ente/ente/releases/tag/photos-v1.3.40)), Memories ([v8.1.0](https://github.com/pulsejet/memories/releases/tag/v8.1.0)), Google, Amazon, LibrePhotos ([1.2.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.2.0)) | PhotoPrism (priority issue, [#720](https://github.com/photoprism/photoprism/issues/720)) |
| **OCR text search** | Product, spreading fast (4 tools added it in 12 months) | Immich ([v2.2.0](https://github.com/immich-app/immich/releases/tag/v2.2.0)), Ente ([v1.2.15](https://github.com/ente/ente/releases/tag/photos-v1.2.15)), LibrePhotos ([1.1.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.1.0)), Piwigo (cloud, [ext](https://piwigo.org/ext/index.php?eid=1070)), digiKam (Tesseract batch tool, [docs](https://docs.digikam.org/en/post_processing/ocrtext_converter.html)) | PhotoPrism, Memories, Lychee, PiGallery2, Synology |
| **Similar-photo stacking / duplicates** | Product | Immich ([v2.7.0](https://github.com/immich-app/immich/releases/tag/v2.7.0)), Synology ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)), LibrePhotos ([2026w10](https://github.com/LibrePhotos/librephotos-docker/releases/tag/2026w10)) | Lychee, PiGallery2. *Automatic* stacking is on Immich's roadmap ([roadmap](https://immich.app/roadmap)) |
| **Non-destructive editor** | Product | Immich ([v2.5.0](https://github.com/immich-app/immich/releases/tag/v2.5.0)), Ente, Google, Apple, Lightroom, digiKam | LibrePhotos, PhotoPrism, Lychee, PiGallery2 |
| **Edits written back to files or XMP** | Product, uneven depth | digiKam (all fields + faces, [docs](https://docs.digikam.org/en/setup_application/metadata_settings.html)), LibrePhotos (all fields + faces, [code](https://github.com/LibrePhotos/librephotos/blob/dev/apps/backend/api/metadata/photo_writer.py)), Memories (EXIF in place, [code](https://github.com/pulsejet/memories/blob/master/lib/Exif.php)), Immich (sidecar: description, rating, date, GPS, tags, [docs](https://docs.immich.app/features/xmp-sidecars)), Lychee (opt-in title, description, tags, rating, [v7.8.0](https://github.com/LycheeOrg/Lychee/releases/tag/v7.8.0)) | PhotoPrism (YAML sidecars only, [config](https://docs.photoprism.app/getting-started/config-options/); [#402](https://github.com/photoprism/photoprism/issues/402)), Ente, PiGallery2 (by design), Piwigo, Google |
| **Face regions written to XMP (MWG-RS)** | Custom | digiKam, LibrePhotos ([2026w14](https://github.com/LibrePhotos/librephotos-docker/releases/tag/2026w14)) | Immich (two PRs closed unmerged: [#27870](https://github.com/immich-app/immich/pull/27870), [#30704](https://github.com/immich-app/immich/pull/30704)); everyone else |
| **Local VLM captions** | Custom | LibrePhotos (built in, 450M model, CPU, [docs](https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/docs/user-guide/image-captioning.md)), PhotoPrism (bring your own Ollama, "a server with GPU is recommended", [docs](https://docs.photoprism.app/user-guide/ai/)) | Immich, Ente, Memories, Lychee, PiGallery2, digiKam, Synology. Piwigo's captioning is cloud |
| **Captions that name recognised people and places** | Genesis | LibrePhotos ([1.2.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.2.0)). Google's personalised AI uses face groups and the "Me" cluster, in the cloud ([blog](https://blog.google/products-and-platforms/products/photos/nano-banana-ai-templates-ask-photos/)) | All other self-hosted tools |
| **Native Windows *server*, no Docker** | Custom | LibrePhotos ([1.2.0](https://github.com/LibrePhotos/librephotos/releases/tag/1.2.0)). Desktop apps (digiKam, Lightroom Classic) are native but single-user | Immich ([requirements](https://docs.immich.app/install/requirements)), PhotoPrism ([docs](https://docs.photoprism.app/getting-started/)), Ente server, Memories ([NC requirements](https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html)), Lychee, PiGallery2, Piwigo |
| **Workflow automation** | Genesis | Immich ([v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)) | Everyone else |
| **Cross-user face sharing** | Genesis | Immich ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)) | Everyone else |
| **End-to-end encryption** | Custom | Ente: "Ente's servers never see your pictures" ([blog](https://ente.com/blog/all-ai-is-not-the-same/)) | All self-hosted servers |
| **LLM / agent interfaces** | Genesis | PhotoPrism MCP ([260523](https://github.com/photoprism/photoprism/releases/tag/260523-0544f71c1)), digiKam LLM search (9.2, pending), Ensu (separate Ente app, [ensu-v0.1.21](https://github.com/ente/ente/releases/tag/ensu-v0.1.21)), Google Ask Photos, OneDrive Photos Agent (secondary source only) | Immich, LibrePhotos, others |

**What this means for positioning**
- **Faces, maps, CLIP search, OIDC, memories and OCR cannot be headline differentiators.** OCR became table stakes inside the last 12 months.
- **The real gap is the mobile backup app.** It is commodity everywhere except LibrePhotos, PhotoPrism, Lychee, PiGallery2 and digiKam. For a Google Photos replacement, this is the one commodity LibrePhotos lacks.

---

## 3. Claimability: can a competitor truthfully claim our differentiator *today*?

**Key**
- **Y** = yes, per their own docs or code.
- **P** = partial.
- **N** = no.
- **n/a** = not meaningful.

**Scope.** Amazon Photos and OneDrive are left out of the table. As consumer clouds they are N on (a), (c), (e) and (f) by construction, and their ML is cloud-side ([Amazon](https://www.aboutamazon.com/news/amazon-prime/how-to-use-amazon-photos-storage)).

| Candidate | Immich | PhotoPrism | Ente | NC Memories | Lychee | PiGallery2 | Piwigo | digiKam | Synology | Google | Apple | Lightroom |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **(a) Native Windows, no Docker** | N, Docker required, no NTFS DB ([req](https://docs.immich.app/install/requirements)) | N, Docker Desktop only ([docs](https://docs.photoprism.app/getting-started/)) | P, the desktop client is native but the server is Docker ([self-host](https://ente.com/help/self-hosting/)) | N, Nextcloud servers are Linux only ([NC](https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html)) | N, not documented ([install](https://lycheeorg.dev/docs/getting-started/manual-installation/)) | N, "unsupported" direct install, Windows undocumented ([docs](https://bpatrik.github.io/pigallery2/setup/direct-install/)) | N, not addressed ([req](https://doc.piwigo.org/self-hosting-piwigo/install-guides/requirements/)) | **Y**, but a single-user desktop app ([download](https://www.digikam.org/download/)) | n/a, NAS appliance | n/a, cloud | n/a, cloud | **Y**, desktop (Classic) ([plans](https://www.adobe.com/products/photoshop-lightroom/plans.html)) |
| **(b) Edits written back to originals or XMP (ratings, captions, faces, dates, GPS)** | P, sidecar for description, rating, date, GPS, tags; **no faces** ([xmp](https://docs.immich.app/features/xmp-sidecars)) | N, YAML sidecars only ([config](https://docs.photoprism.app/getting-started/config-options/); [#402](https://github.com/photoprism/photoprism/issues/402)) | N, encrypted store ([export](https://ente.com/help/photos/migration/export/)) | P, writes title, description, GPS, date, tags into the file; no faces or sidecars ([Exif.php](https://github.com/pulsejet/memories/blob/master/lib/Exif.php), [site](https://memories.gallery/)) | P, opt-in title, description, tags, rating; no GPS, dates or faces ([spec 059](https://github.com/LycheeOrg/Lychee/blob/master/docs/specs/4-architecture/features/059-embed-metadata-in-file/spec.md)) | N, never writes ([FAQ](https://bpatrik.github.io/pigallery2/faq/)) | N, third-party plugin only ([forum](https://piwigo.org/forum/viewtopic.php?id=30169)) | **Y**, all fields + face rectangles ([docs](https://docs.digikam.org/en/setup_application/metadata_settings.html)) | P/unknown, edits dates, descriptions, tags, ratings; write-back unstated ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)) | N, not documented | P, IPTC/keywords as XMP on export ([support](https://support.apple.com/guide/photos/export-photos-videos-and-slideshows-pht6e157c5f/mac)) | Y (Classic XMP), not re-verified |
| **(c) Folder structure stays the source of truth / read-only library** | P, external libraries can be `:ro`, but "metadata… only stored inside Immich" there ([libraries](https://docs.immich.app/features/libraries)) | **Y**, originals folder plus `PHOTOPRISM_READONLY` ([config](https://docs.photoprism.app/getting-started/config-options/)) | N, uploads into an encrypted store | **Y**, "existing filesystem structure" ([site](https://memories.gallery/)) | P, `lychee:sync` import with optional symlinks ([Sync.php](https://github.com/LycheeOrg/Lychee/blob/master/app/Console/Commands/Sync.php)) | **Y**, "disk is the source of truth" ([FAQ](https://bpatrik.github.io/pigallery2/faq/)) | P, FTP plus manual sync ([docs](https://doc.piwigo.org/self-hosting-piwigo/importing-and-synchronizing-ftp-photos)) | **Y**, collections ([docs](https://docs.digikam.org/en/setup_application/collections_settings.html)) | P, folder view ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)) | N | N | Y (Classic) |
| **(d) All ML local, CPU-only, low RAM / ARM64** | P, local ONNX on CPU, arm64, but **6 GB minimum** ([req](https://docs.immich.app/install/requirements)). v3.3 opt-in models cut memory ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)) | P, local ONNX, 3 GB minimum, arm64; captions need Ollama (GPU recommended) or the OpenAI cloud ([AI](https://docs.photoprism.app/user-guide/ai/), [docs](https://docs.photoprism.app/getting-started/)) | P, all ML on the *client* device; server 1 GB ([ML help](https://ente.com/help/photos/features/search-and-discovery/machine-learning)) | P, Recognize runs locally; remote backend optional ([recognize v13](https://github.com/nextcloud/recognize/releases/tag/v13.0.0)) | P, local TensorFlow sidecar, about a 500 MB image ([README](https://github.com/LycheeOrg/Lychee-Facial-Recognition/blob/master/README.md)) | n/a, no ML | N, AI runs on Pigolabs servers ([README](https://github.com/Piwigo/piwigo-ai)) | P, local, but "16 GB RAM and 8 cores" for AI and no Linux ARM64 build ([install](https://docs.digikam.org/en/getting_started/installation.html)) | P, on-NAS, "certain models" only ([spec](https://www.synology.com/en-global/dsm/7.4/software_spec/synology_photos)) | N, Gemini in the cloud | P, faces and scenes on-device, editing tools server-side ([privacy](https://www.apple.com/privacy/features/), [iOS](https://www.apple.com/ios/)) | P, generative features run on cloud credits ([plans](https://www.adobe.com/products/photoshop-lightroom/plans.html)); local features not verified |
| **(e) Fully free, no paid tier or licence key** | **P→Y**, "never any paywalled features", but sells optional keys and plans a paid backup service ([keys](https://immich.app/blog/immich-product-keys), [FUTO](https://immich.app/blog/futo-two-years-later)) | N, paid maps, roles, admin UI ([editions](https://www.photoprism.app/editions)) | P, self-host free; cloud paid ([pricing](https://ente.com/pricing)) | **Y** | N, Supporter Edition and Pro ([SE](https://lycheeorg.dev/get-supporter-edition/)) | **Y** ([FAQ](https://bpatrik.github.io/pigallery2/faq/)) | P, self-host free; AI and SSO paid in hosted plans ([pricing](https://piwigo.org/pricing)) | **Y** ([donate](https://www.digikam.org/donate/)) | N, hardware | N, storage and AI paid ([plans](https://one.google.com/about/plans)) | N ([iCloud](https://www.apple.com/icloud/)) | N |
| **(f) Community-governed, no company** | N, FUTO and a BDFL ([FUTO](https://immich.app/blog/futo-two-years-later)) | N, PhotoPrism UG | N, Ente | P, no company, but a solo maintainer | P, no company; open core run by one main developer | P, solo hobby | N, Pigolabs ([announcement](https://piwigo.org/forum/viewtopic.php?id=34916)) | **Y**, KDE ([donate](https://www.digikam.org/donate/)) | N | N | N | N |
| **(g) OIDC SSO, free** | **Y** ([oauth](https://docs.immich.app/administration/oauth)) | **Y**, Community; a higher default role is Pro ([OIDC](https://docs.photoprism.app/getting-started/advanced/openid-connect/)) | N, not found | P, via Nextcloud [user_oidc](https://github.com/nextcloud/user_oidc) | P, named providers only, no generic OIDC ([enum](https://github.com/LycheeOrg/Lychee/blob/master/app/Enum/OauthProvidersType.php)) | **Y** ([3.5.2](https://github.com/bpatrik/pigallery2/releases/tag/3.5.2)) | N, VIP plan or a 2021 plugin ([pricing](https://piwigo.org/pricing), [ext](https://piwigo.org/ext/index.php?eid=918)) | n/a | not stated in the Photos spec | n/a | n/a | n/a |
| **(h) OCR / document detection** | **Y**, OCR on web and mobile ([v2.2.0](https://github.com/immich-app/immich/releases/tag/v2.2.0), [v3.0.0](https://github.com/immich-app/immich/releases/tag/v3.0.0)); no document category | P, PDF viewer, no OCR ([260728](https://github.com/photoprism/photoprism/releases/tag/260728-bbde8f452)) | **Y**, OCR, QR, and Locker document scanning ([v1.2.15](https://github.com/ente/ente/releases/tag/photos-v1.2.15), [locker-v1.0.9](https://github.com/ente/ente/releases/tag/locker-v1.0.9)) | N | N | N | P, cloud OCR ([ext](https://piwigo.org/ext/index.php?eid=1070)) | P, Tesseract batch tool ([docs](https://docs.digikam.org/en/post_processing/ocrtext_converter.html)) | N | likely Y, not verified this session | likely Y (Live Text), not verified this session | n/a |
| **(i) Local VLM captions with names and places** | N | P, local captions via external Ollama; no evidence of name or place context ([AI](https://docs.photoprism.app/user-guide/ai/)) | N | N | N | N | N, cloud ([README](https://github.com/Piwigo/piwigo-ai)) | N | N | N, cloud Gemini | N, VoiceOver descriptions only ([iOS](https://www.apple.com/ios/)) | N |
| **(j) No lock-in export** | P→Y, originals on disk + XMP sidecars; faces and albums stay in the DB ([xmp](https://docs.immich.app/features/xmp-sidecars)) | P, originals untouched; metadata in non-standard YAML ([config](https://docs.photoprism.app/getting-started/config-options/)) | P, continuous export of originals; metadata format unstated ([export](https://ente.com/help/photos/migration/export/)) | **Y**, plain files with EXIF | P, zip downloads; partial write-back | **Y** | P | **Y** | P | P, Takeout | P, unmodified originals + IPTC XMP | P/Y (Classic) |

**Reading the table**
- **(a) Native Windows server, no Docker. Strongest and most durable.** No self-hosted *server* competitor can claim it. digiKam and Lightroom Classic are native but single-user desktop apps.
  - **Phrase it as:** "the only self-hosted photo server that runs natively on Windows".
  - **Not as:** "runs on Windows".
- **(b) Edits written back to files. Strong, but shared with digiKam.** Among servers, only LibrePhotos covers every field *plus faces*. Immich is one merged PR away on faces.
- **(c) Folder structure as source of truth. Not a differentiator.** PhotoPrism, Memories, PiGallery2 and digiKam claim it fully.
- **(d) Local CPU-only ML. Partial everywhere, so the claim must be precise.** For example: "every model runs on CPU via ONNX on the server, 4 GB recommended, ARM64".
  - Ente is client-side; Immich needs 6 GB.
  - PhotoPrism's captioning needs Ollama (GPU recommended) or the OpenAI cloud.
- **(e) Fully free. Weak against Immich**, whose "no paywalled features" is effectively the same claim. **Strong against PhotoPrism, Lychee and Piwigo.**
- **(f) No company. True, but digiKam has the better claim**, and LibrePhotos' 82 % single-maintainer share undercuts "community-governed".
  - **Phrase it as:** "no company, MIT".
- **(g) Free OIDC. Not a differentiator.** Immich, PhotoPrism and PiGallery2 all claim it.
- **(h) OCR. Not a differentiator.** Immich and Ente claim OCR. The deterministic screenshot and document *categories* are the only distinctive part.
- **(i) Local captions with names and places. Unique today, but the cheapest to copy.** See §4.
- **(j) No lock-in. Shared** with Memories, PiGallery2 and digiKam. It is LibrePhotos' strongest *combined* claim when paired with (b).

---

## 4. Threats: what could erase a LibrePhotos advantage in 6 to 12 months

| # | Threat | Advantage at risk | Evidence of motion | Likelihood (6–12 mo) |
|---|---|---|---|---|
| 1 | **Immich merges face-region XMP export** | (b), (j) | Two PRs in 2026 ([#27870](https://github.com/immich-app/immich/pull/27870), [#30704](https://github.com/immich-app/immich/pull/30704)); the sidecar-write path already exists ([xmp docs](https://docs.immich.app/features/xmp-sidecars)); people sharing is the team's current focus ([Sept recap](https://github.com/immich-app/static-pages/blob/main/apps/root.immich.app/src/routes/(shell)/blog/(recaps)/2026-september-recap/+page.md)) | **Medium.** Demand exists; maintainers have not rejected the idea |
| 2 | **Immich makes the leaner ML models the default and lowers its RAM floor** | (d) | v3.3.0: "significantly faster and uses less memory… This setting will be the default in a later release" ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)) | **High** for the default switch; unknown whether the documented 6 GB minimum drops |
| 3 | **PhotoPrism ships CLIP semantic search** | Removes one LibrePhotos-over-PhotoPrism edge | [#1287](https://github.com/photoprism/photoprism/issues/1287) got implementation steps in November 2025; Qdrant is already in dev compose ([commit](https://github.com/photoprism/photoprism/commit/aa687ade0)); TensorFlow removal is under way ([#5890](https://github.com/photoprism/photoprism/issues/5890)) | **Medium** |
| 4 | **Name- and place-aware captions get copied.** PhotoPrism adds face and location context to its Ollama prompts; Immich or Ente add a VLM | (i) | PhotoPrism already has the caption pipeline, through its Ollama and OpenAI engines ([AI docs](https://docs.photoprism.app/user-guide/ai/)); Ente runs a local-LLM stack (Ensu, [v0.1.21](https://github.com/ente/ente/releases/tag/ensu-v0.1.21)) and admits it trails Ask Photos ([blog](https://ente.com/blog/all-ai-is-not-the-same/)) | **Medium for PhotoPrism**, since it is a prompt change. Low to medium for Ente and Immich, with no public signal |
| 5 | **Immich ships smart albums, smart memories and automatic stacking** | Parity: LibrePhotos' stacks, memories and auto-albums | All three are "Soon™" on the [roadmap](https://immich.app/roadmap); birthday memories and a memories page already shipped ([v3.3.0](https://github.com/immich-app/immich/releases/tag/v3.3.0)) | **High** |
| 6 | **PhotoPrism writes XMP** | (b) against PhotoPrism | Both issues are `priority` but `needs-analysis` / `idea`, open since 2020 ([#243](https://github.com/photoprism/photoprism/issues/243), [#402](https://github.com/photoprism/photoprism/issues/402)) | **Low** |
| 7 | **A competitor ships a native Windows build** | (a) | Immich: a community PR for native-Windows ML was closed unmerged on 2026-06-24 ([#29297](https://github.com/immich-app/immich/pull/29297)), and the docs still say Docker plus no NTFS ([req](https://docs.immich.app/install/requirements)). PhotoPrism: Go binaries would make it technically easy, but its docs point to Docker Desktop ([docs](https://docs.photoprism.app/getting-started/)) | **Low.** This is the most durable advantage |
| 8 | **Lychee makes faces free and on by default when v8 ships** | Lychee drops off the "no faces" list | Code is already free-gated ([routes](https://github.com/LycheeOrg/Lychee/blob/8bf3f2815d153fe43b679e6698119575a1959c65/routes/api_v2.php#L422)); the v8 flag is off ([features.php](https://github.com/LycheeOrg/Lychee/blob/8bf3f2815d153fe43b679e6698119575a1959c65/config/features.php)) | **High.** Minor threat |
| 9 | **Piwigo adds core people management plus cloud AI search** | "Local AI" contrast gets sharper, not weaker | [#2560](https://github.com/Piwigo/Piwigo/issues/2560) is on 17.0.0beta1; embeddings are planned for natural-language search ([README](https://github.com/Piwigo/piwigo-ai)) | Medium. It is cloud-processed, so LibrePhotos' local-ML message gains |
| 10 | **digiKam 9.2 ships local-LLM natural-language search** | "Local AI, natural-language search" for desktop users | [Announcement](https://www.digikam.org/news/2026-08-20-advanced_search_improvements_with_llm/), GSoC merge request open ([report](https://community.kde.org/GSoC/2026/StatusReports/SrirupaDatta)) | **High.** It is a desktop app, and it filters rather than doing CLIP search |
| 11 | **Big clouds deepen conversational search and editing** (Google Ask Photos in 100+ new countries; Apple iOS 27 Extend/Reframe; OneDrive Photos Agent) | Raises expectations: "ask my photos" becomes table stakes in the paid clouds | [Google Nov 2025](https://blog.google/products-and-platforms/products/photos/nano-banana-ai-templates-ask-photos/), [Apple iOS 27](https://www.apple.com/ios/), OneDrive event on 2026-10-20 ([Tech Community](https://techcommunity.microsoft.com/blog/onedriveblog/save-the-date-join-us-october-20-for-the-onedrive--copilot-digital-event/4556814)) | **High.** The newest Google features are paywalled and US-first ([Sept 2026](https://blog.google/products-and-platforms/products/photos/google-photos-updates/)), which helps the "local, free, everywhere" message |
| 12 | **Immich launches its encrypted backup service** | (e) muddies a little: "Immich has a paid service" works in LibrePhotos' favour only if "no paid anything" is our message | "working on an encrypted backup product" ([FUTO](https://immich.app/blog/futo-two-years-later)) | Medium |

**Bottom line for positioning**
- **Build on (a)** native Windows server, **(b)+(j)** full write-back including faces with no lock-in, and **(i)** local captions that know names and places.
- **Lead with (a), (b) and (j).** Treat (i) as a 6-to-12-month head start, not a moat.
- **Do not lead with** faces, CLIP search, maps, OIDC, OCR, memories, or "folders as source of truth". Those are commodity or shared.
- **The biggest commodity hole is the mobile backup app.** Shipping `apps/mobile` matters more for "Google Photos replacement" messaging than any claim in §3.

---

## 5. Gaps and things not verified this session

**Fetch failures**
- **PhotoPrism's roadmap board** ([projects/5](https://github.com/orgs/photoprism/projects/5)) needs `read:project` scope; we did not change token scopes. We used `priority` and `in-progress` issues instead.
- **Adobe helpx** (Lightroom what's-new, XMP behaviour) returned 403.
- **Synology's face-recognition model list** (KB) is rendered by JavaScript and could not be read.
- **No OneDrive photo post from Microsoft** turned up in this session.

**Unverified claims**
- The month of the latest point on Ente's metrics charts.
- Whether Synology Photos writes metadata edits to files.
- Google's Takeout metadata format, from a Google source.
- Apple and Google OCR depth.
- digiKam 9.2's release date.

**Re-check soon**
- **After 2026-10-20:** the OneDrive + Copilot event.
- **On every Immich release:** whether `MACHINE_LEARNING_MODEL_REVISION=v2` becomes the default and whether the 6 GB minimum changes. Also any face-XMP PR.
- **On the next PhotoPrism release:** activity on [#1287](https://github.com/photoprism/photoprism/issues/1287).
