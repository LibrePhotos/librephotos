---
title: " 🖼 Photo List"
description: "How to fetch alot of images as a developer"
sidebar_position: 5
---

## Endpoints:

:::note
The boolean flags below (`favorite`, `public`, `hidden`, `video`, `photo`, `in_trashcan`, `show_all_stack_photos`) are plain truthiness checks on the query string: any non-empty value enables them, so `?hidden=false` still returns hidden images. Omit a flag to get the default behaviour. `in_trashcan` was previously named `deleted`; clients that still send `?deleted=true` are silently ignored and receive the normal timeline rather than the trashcan.
:::

### `GET /api/albums/date/list/`

Gives you a list of days with the number of elements. This is not paginated and can be large.

#### Parameters:

- `?favorite=true` - Give me the list for favorite images
- `?public=true&username=<name>` - Give me the list of this user's public images. On this endpoint the two are coupled: `username` is applied even when absent, so `?public=true` on its own filters on `owner__username IS NULL` and always returns an empty result set.
- `?in_trashcan=true` - Give me the list for images currently in the trashcan (images already marked as removed are excluded)
- `?person=<id>` - Give me the list for this person
- `?hidden=true` - Return hidden images instead of the default non-hidden ones
- `?video=true` - Videos only
- `?photo=true` - Photos only (non-videos). `video` and `photo` are independent filters, so sending both at once returns nothing.
- `?folder=<prefix>` - Only images whose file path starts with this prefix (a prefix match, not folder equality)
- `?show_all_stack_photos=true` - By default only the primary photo of each stack (plus images in no stack) is counted; pass this to include non-primary stack members. This changes the per-day counts that "How React Pig works" relies on below.
- `?last_modified=<date>` - Only days containing images last modified on or after this date. This rebuilds the filter set from scratch, so it cannot be combined with any of the parameters above.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /api/albums/date/<id>`

Returns the actual images, for a given day in chunks of 100 images by default.

#### Parameters:

- `?page=1` - Give me the first page of the album
- `?size=<n>` - Change the chunk size (default 100). This endpoint paginates manually, so the parameter is `size`, not the `page_size` used by the paginated endpoints, and the value is passed straight to the paginator without an upper bound.
- `?favorite=true` - Give me the list for favorite images
- `?public=true` - Give me the list for public images. Here `username` is optional: `?public=true` on its own returns the day's public images regardless of owner.
- `?username=<name>` - Restrict the public images to this owner (only takes effect together with `?public=true`)
- `?in_trashcan=true` - Give me the list for images currently in the trashcan (images already marked as removed are excluded)
- `?person=<id>` - Give me the list for this person
- `?hidden=true` - Return hidden images instead of the default non-hidden ones
- `?video=true` - Videos only
- `?photo=true` - Photos only (non-videos). `video` and `photo` are independent filters, so sending both at once returns nothing.
- `?folder=<prefix>` - Only images whose file path starts with this prefix (a prefix match, not folder equality)
- `?show_all_stack_photos=true` - By default only the primary photo of each stack (plus images in no stack) is returned; pass this to include non-primary stack members.
- `?last_modified=<date>` - Only images with an EXIF timestamp on or after this date. This rebuilds the filter set from scratch, so it cannot be combined with any of the parameters above.

#### Headers:

- `Authorization` - `Bearer <token>`

## How React Pig works

- Fetch the number of days with the count of all images with `GET /api/albums/date/list/`.
- Based on the number of photos per day, create a bunch of empty `<div/>` with the attribute `isTemp` and an `aspectRatio=1` which will then be rendered as by react-pig.
- `react-pig` calculates a somewhat accurate height for scrolling based on the number of elements and the `aspectRatio`.
- When scrolling, the `isTemp` element is used to determine, if a currently visible element is actually loaded yet or not. If not, load the missing images with `GET /api/albums/date/4/`
