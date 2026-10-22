---
title: " 🖼 Photo List"
description: "How to fetch alot of images as a developer"
sidebar_position: 5
---

## Endpoints:

:::note
`public`, `hidden`, `in_trashcan` and `show_all_stack_photos` are booleans: `true`, `1`, `yes` or `on` switch them on, `false`, `0`, `no`, `off` or a blank value leave them off, and any other value is a 400 naming the parameter. The media filters (`favorite`, `video`, `photo`, `is_screenshot`, `is_document`) are read more leniently: a false word turns them off and any other value on. `person` must be a number and `last_modified` a date (`2024-01-31`) or an ISO 8601 date-time, otherwise the answer is a 400. <Since version="1.4.0" /> LibrePhotos 1.3.0 and earlier read every flag by truthiness, so `?public=false` still opened the public view. Omit a flag to get the default behaviour. `in_trashcan` was previously named `deleted`; clients that still send `?deleted=true` are silently ignored and receive the normal timeline rather than the trashcan.
:::

### `GET /api/albums/date/list/`

Gives you a list of days with the number of elements. This is not paginated and can be large.

#### Parameters:

- `?favorite=true` - Give me the list for favorite images
- `?public=true` - Give me the list for public images of every user; no sign-in needed. Add `&username=<name>` for one user's public images (`username` only takes effect together with `public`).
- `?in_trashcan=true` - Give me the list for images currently in the trashcan (images already marked as removed are excluded)
- `?person=<id>` - Give me the list for this person
- `?hidden=true` - Return hidden images instead of the default non-hidden ones
- `?video=true` - Videos only
- `?photo=true` - Photos only (non-videos). `video` and `photo` are independent filters, so sending both at once returns nothing.
- `?folder=<prefix>` - Only images whose file path starts with this prefix (a prefix match, not folder equality)
- `?show_all_stack_photos=true` - By default only the primary photo of each stack (plus images in no stack) is counted; pass this to include non-primary stack members. This changes the per-day counts that "How React Pig works" relies on below.
- `?last_modified=<date>` - Only days containing images last modified on or after this date (or date-time). For the signed-in owner this rebuilds the filter set from scratch, so it cannot be combined with any of the parameters above; with `public` it only narrows the public images.

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /api/albums/date/<id>`

Returns the actual images, for a given day in chunks of 100 images by default. `results` is the day with one page of its images in `items` and the day's total in `numberOfItems`; the page fields of every paginated list (`count`, `next`, `previous`, `page`, `page_size`, `num_pages`) sit next to it.

#### Parameters:

- `?page=1` - Give me the first page of the album. A page past the end answers the last page, and one that is not a number the first, because clients work the page numbers out from the day's count, which may be out of date.
- `?page_size=<n>` - Change the chunk size (default 100, at most 1000), as on every [paginated list](index.md#pagination). A value below 1 counts as 1; a value that is not a number is a 400.
- (Not released yet: up to 1.4.0, `?size=<n>` was read as an alias of `page_size` when `page_size` was absent.)
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
- `?last_modified=<date>` - Only images with an EXIF timestamp on or after this date (or date-time). For the signed-in owner this rebuilds the filter set from scratch, so it cannot be combined with any of the parameters above; with `public` it only narrows the public images.

#### Headers:

- `Authorization` - `Bearer <token>`

## How React Pig works

- Fetch the number of days with the count of all images with `GET /api/albums/date/list/`.
- Based on the number of photos per day, create a bunch of empty `<div/>` with the attribute `isTemp` and an `aspectRatio=1` which will then be rendered as by react-pig.
- `react-pig` calculates a somewhat accurate height for scrolling based on the number of elements and the `aspectRatio`.
- When scrolling, the `isTemp` element is used to determine, if a currently visible element is actually loaded yet or not. If not, load the missing images with `GET /api/albums/date/4/`
