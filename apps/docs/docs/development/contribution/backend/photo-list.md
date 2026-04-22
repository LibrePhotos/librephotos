---
title: " 🖼 Photo List"
excerpt: "How to fetch alot of images as a developer"
sidebar_position: 5
---

## Endpoints:

### `GET /api/albums/date/list/`

Gives you a list of days with the number of elements. This is not paginated and can be large.

#### Parameters:

- `?favorite=true` - Give me the list for favorite images
- `?public=true` - Give me the list for public images
- `?username=<name>` - Give me the list of this users public images
- `?deleted=true` - Give me the list for deleted images
- `?person=<id>` - Give me the list for this person

#### Headers:

- `Authorization` - `Bearer <token>`

### `GET /api/albums/date/<id>`

Returns the actual images, for a given day in chunks of 100 images.

#### Parameters:

- `?page=1` - Give me the first page of the album
- `?favorite=true` - Give me the list for favorite images
- `?public=true` - Give me the list for public images
- `?username=<name>` - Give me the list of this users public images
- `?deleted=true` - Give me the list for deleted images
- `?person=<id>` - Give me the list for this person

#### Headers:

- `Authorization` - `Bearer <token>`

## How React Pig works

- Fetch the number of days with the count of all images with `GET /api/albums/date/list/`.
- Based on the number of photos per day, create a bunch of empty `<div/>` with the attribute `isTemp` and an `aspectRatio=1` which will then be rendered as by react-pig.
- `react-pig` calculates a somewhat accurate height for scrolling based on the number of elements and the `aspectRatio`.
- When scrolling, the `isTemp` element is used to determine, if a currently visible element is actually loaded yet or not. If not, load the missing images with `GET /api/albums/date/4/`
