---
title: "Frontend"
excerpt: "Development Information regarding LibrePhotos Frontend."
last_modified_at: 2021-05-31
category: 5
---
We developed our frontend with the following technologies:
- React
- Semantic UI
- Redux
- Axios

## Structure

- You can find all the routes in [App.js](https://github.com/LibrePhotos/librephotos-frontend/blob/dev/src/App.js).
- The pages are in [layouts](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/layouts)
- Pages should be split up into React Components, which you can find in 
  [components](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/components)
- The API calls are made into split into actions, which you can find in 
  [actions](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/actions)
- To handle the state for the whole page we use redux. You can find the states and reducers in 
  [reducers](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/reducers)
- [api_client](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/api_client) is just a simple axios
  client
- In [util](https://github.com/LibrePhotos/librephotos-frontend/tree/dev/src/util) you can find miscellaneous functions.

## REST API

Our Rest API is documented with [Swagger](https://swagger.io/) and [ReDoc](https://redocly.github.io/redoc/). After you
start up LibrePhotos you can find them under:
```
localhost:3000/api/swagger
```
```
localhost:3000/api/redoc 
```

## To-Do

You can look into the issues [here](https://github.com/LibrePhotos/librephotos/issues?q=is%3Aopen+is%3Aissue+label%3Afrontend),
on what features are missing from the frontend.

We should also improve the maintainability.

Most of the files are too large and should be under 300 lines of code. To achieve that we can do multiple things:
- The layouts should be split into components
- Functions that are used in multiple classes should be moved into utils 
- One file should only contain one class

It would also be great if we could introduce some 
[test coverage and automated testing](https://create-react-app.dev/docs/running-tests/).
