---
title: "Glossary"
description: "The canonical name of each LibrePhotos domain concept, where it lives in the code, and the legacy names new code must not copy."
sidebar_position: 3
---

Several concepts go by different names in the UI, the models, the URLs and the clients. This page says which name is canonical. Name new code (variables, types, endpoints, UI strings, docs) after the term in the first column. Legacy names stay where they are because clients depend on them, but new code does not copy them.

Backend paths are relative to `apps/backend`.

## Rules for new code

- JSON keys are snake_case. `api/tests/infra/test_api_naming.py` fails on a camelCase serializer field, `openapi.json` property or dict key; the legacy keys listed there only shrink.
- A new route takes a photo as `Photo.id` in a `photo_id` URL argument; `image_hash` is for content-hash lookups. The same test fails on a new `image_hash` URL argument.
- "Tag" means the user's `Tag`. What OpenCLIP detects in a photo is a "thing".

## Terms

| Term (UI) | Code | API | Legacy names |
| --- | --- | --- | --- |
| Photo | `Photo` (`api/models/photo.py`), a photo or a video; identified by `id` (UUID) | `api/photos/` | `url` serializer field (repeats `image_hash`) |
| Image hash | `Photo.image_hash`: content MD5 plus owner id; names the thumbnail files | `api/photos/<image_hash>/file/<file_hash>/`, `main-file/` (the only routes keyed by it) | |
| File | `File` (`api/models/file.py`), one file on disk, keyed by `File.hash`; a photo has `files` and a `main_file` | `file_variants` on a photo | |
| File variant | Another `File` of the same photo: RAW next to JPEG, a live photo's video | `file_variants`, `api/photos/<image_hash>/file/<file_hash>/` | the `raw_jpeg` and `live_photo` stack types |
| Embedded media | `File.embedded_media`, a clip extracted from a motion photo | `embedded_media[].id` (a `File.hash`) | |
| Thumbnail | `Thumbnail` (`api/models/thumbnail.py`), sizes in `SQUARE_THUMBNAIL_HEIGHTS` (`api/thumbnails/render.py`) and the `BIG_THUMBNAIL_HEIGHT` setting: big 1080 px by default, grid 500 px and 250 px high, aspect ratio kept (videos: short mp4) | `big_thumbnail_url`, `/media/` | `square_thumbnails`, `square_thumbnails_small` (directories, `/media/` paths), `square_thumbnail_url`, `small_square_thumbnail_url`, api-client `squareThumbnailUrl`, `squareThumbnailSmallUrl`: not square, kept so files and shipped apps keep working |
| Stack | `PhotoStack` (`api/models/photo_stack.py`): burst, exposure bracket or manual | `api/stacks/` | |
| Duplicate | `Duplicate` (`api/models/duplicate.py`): exact copies or visual duplicates, reviewed by the user | `api/duplicates/` | |
| Event | `AlbumAuto` (`api/models/album_auto.py`), photos grouped by time; web route `/album/events/$id` | `api/albums/auto/`, `api/autoalbumgen/`, `api/autoalbumtitlegen/` | auto album, event album, `JOB_GENERATE_AUTO_ALBUMS` |
| Day group | `AlbumDate` (`api/models/album_date.py`), the per-day groups the timeline is built from; never shown as an album | `api/albums/date/` | date album |
| Thing | An OpenCLIP label for what is in a photo: `captions_json["openclip_vitb32"]["tags"]`, `AlbumThing` with `thing_type=TAG_THING_TYPE` (`api/search/semantic.py`); `hashtag_attribute` things come from caption hashtags | `api/albums/thing/`, `api/sync/albums/thing/` | auto tags, tag album, scene classification (`FEATURE_SCENE_CLASSIFICATION`), `tags` service, `JOB_GENERATE_TAGS` |
| Tag | `Tag` (`api/models/tag.py`), the user's own label | `api/tags/`, `api/sync/albums/tag/` | tag album (`SyncTagAlbumsView`) |
| Keyword | `PhotoMetadata.keywords` (`api/models/photo_metadata.py`), from XMP `Subject` and IPTC `Keywords`; a scan also adds each one as a Tag (`link_tags_from_keywords`) | `keywords` in photo metadata | |
| Media category | `Photo.is_screenshot`, `Photo.is_document`, `category_source`; a separate classifier, not Things | `api/classifymedia/`, `api/photosedit/category/` | |
| Person | `Person` (`api/models/person.py`), UI "People"; kind user-labelled, cluster or unknown | `api/persons/`, `people` on an event (items carry `id`) | |
| Face | `Face` (`api/models/face.py`), one detected face, labelled with a Person | `api/faces/`, `people` on a photo (items are faces and carry `face_id`) | |
| Face cluster | `Cluster` (`api/models/cluster.py`), unlabelled faces grouped by similarity | `api/clusterfaces/` | |
| Place | `AlbumPlace` (`api/models/album_place.py`), photos grouped by geocoded location | `api/albums/place/` | |
| My album | `AlbumUser` (`api/models/album_user.py`), an album the user made | `api/albums/user/` | user album |
| Memory | Computed in `api/views/memories.py`, no model | `api/memories/` | |
| Job | `LongRunningJob` (`api/models/long_running_job.py`) | `api/jobs/` | |
| Image tag | The backend image's tag (`IMAGE_TAG`), not a Tag | `api/imagetag/` | |

## Client types

| Type | Where | What |
| --- | --- | --- |
| `PhotoPerson` | `packages/api-client/src/schemas/photos.ts` | One face entry in `Photo.people` (`face_id`, `location`). `People` is its deprecated alias. |
| `PersonList` | `apps/frontend/src/api_client/albums/hooks/useFetchPeopleAlbumsQuery.ts` | A list of `Person` (the People album list). |

## Legacy camelCase keys

These keys predate the snake_case rule. Renaming one is an API break for the web app, `packages/api-client` and shipped mobile builds, so it needs a deprecation period that sends both keys. `test_api_naming.py` holds the list.

`aspectRatio`, `dominantColor`, `birthTime` (photo summaries), `focalLength35Equivalent`, `digitalZoomRatio`, `subjectDistance` (photo detail), `numberOfItems` (day groups, memories), `removedPhotos` (album edit), `newPersonName` (person edit), `isFirstTimeSetup` (`api/firsttimesetup/`).
