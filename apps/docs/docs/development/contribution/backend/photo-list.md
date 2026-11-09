---
title: " 🖼 Photo List"
description: "How to fetch alot of images as a developer"
sidebar_position: 5
---

## Endpoints:

The timeline and every list built like it (favourites, a person, a folder, the trash, a shared library, a user's public page) are read day by day. A day is not stored: a photo belongs to the day of its date taken (`exif_timestamp`, wall-clock time), or to the undated group when it has none. All three endpoints take the same filters, so a day's count, its pages and its layout always agree.

Up to 1.5.x these were `GET /api/albums/date/list/` and `GET /api/albums/date/<id>/?page=N`. Both still answer, read-only and deprecated, for released clients such as UhuruPhotos: they take the same filters plus `last_modified`, use the day ids below, and page a day by offset, which is slow on very large days. New clients use the endpoints below.

:::note
`public`, `hidden`, `in_trashcan`, `show_all_stack_photos` and `libraries` are booleans: `true`, `1`, `yes` or `on` switch them on, `false`, `0`, `no`, `off` or a blank value leave them off, and any other value is a 400 naming the parameter. The media filters (`favorite`, `video`, `photo`, `is_screenshot`, `is_document`, `hide_screenshots`, `hide_documents`, `archived`) are tri-state: a false word turns them off, any other value on, and leaving them out applies neither. `person` and `library` must be numbers, otherwise the answer is a 400.
:::

#### Filters (all three endpoints):

- `?favorite=true` - Favourite images only (rated at least the user's favourite rating)
- `?public=true&username=<name>` - That user's public images; no sign-in needed. The user's public profile must be on. An owner who keeps dates to themselves shows all their public images as one undated group.
- `?in_trashcan=true` - Images currently in the trashcan (images already marked as removed are excluded)
- `?hidden=true` - Hidden images instead of the default non-hidden ones
- `?person=<id>` - Images showing this person
- `?folder=<prefix>` - Images with a file under this folder
- `?video=true`, `?photo=true`, `?media=photos|videos` - Videos only, or photos only
- `?is_screenshot=true`, `?is_document=true` - Only that category (`false` hides it); `?hide_screenshots=true`, `?hide_documents=true` hide it
- `?archived=false` - Leave archived images out (the timeline); `true` shows only them
- `?apply_default=true` - Apply the user's saved timeline filter first
- `?library=<owner id>` - The library another user shares with you, instead of yours
- `?libraries=true` - Also the libraries you show in your timeline
- `?show_all_stack_photos=true` - Also the photos of a stack that are not its primary
- `?order=oldest` - Oldest day first (and each day's photos oldest first); the undated group stays last

#### Headers:

- `Authorization` - `Bearer <token>` (not needed with `public=true`)

### `GET /api/days/`

The days, newest first: `{"results": [{"id", "date", "location", "numberOfItems"}]}`. `id` is the day as `YYYYMMDD`, `1` for the undated group (`date` is null there). `location` is the town of the day's first located photo, when its owner shares where it was taken. Not paginated.

### `GET /api/days/<id>/photos/`

A page of a day's images: `{"items": [...], "next": <photo id> | null}`.

- `?after=<photo id>` - The images after this one: the previous page's `next`, or a layout's `page_after`. Leave it out for the first page. A photo that is not in this day any more (deleted, hidden, moved to another day) is a 400 on `after`; read the day's layout again.
- `?limit=<n>` - How many images (default 100, at most 500)

Images taken in the same second keep the order of their file paths, which is how a camera numbers a burst.

### `GET /api/days/<id>/layout/`

What a client lays a day out with before its images load: `{"id", "numberOfItems", "aspectRatios": [...], "page_after": [...]}`. `aspectRatios` holds every image's aspect ratio in the day's order. `page_after[i]` is the `after` that opens page `i + 1` of `limit` images (`?limit=<n>`, default 100), null for the first.

## How React Pig works

- Fetch the days with the count of their images with `GET /api/days/`.
- Based on the number of photos per day, create a bunch of empty `<div/>` with the attribute `isTemp`, which will then be rendered by react-pig. A day of more than one page also gets its layout, which gives the placeholders their real aspect ratio.
- `react-pig` calculates the height for scrolling from the number of elements and their `aspectRatio`.
- When scrolling, the `isTemp` element is used to determine if a currently visible element is actually loaded yet or not. If not, load its page with `GET /api/days/<id>/photos/?after=...`: the previous page's `next` when that page is loaded, else the cursor from the day's layout, so the grid can jump into the middle of a 200,000-photo day.
