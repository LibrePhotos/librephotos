---
title: "🖱️ To-Do"
excerpt: "On going migrations regarding the mobile app."
last_modified_at: 2021-05-31
category: 5
---

You can look into the issues [here](https://github.com/LibrePhotos/librephotos/issues?q=is%3Aopen+is%3Aissue+label%3Amobile),
on what features are missing from the frontend.

**Show local images everywhere**

The local images to not yet show up in all views. You can help out by adding them to the views by implementing new selectors.

**Maintainability**

We currently are working on improving maintainability, by converting our code base to TypeScript. There are still alot of classes, which are written in plain JavaScript. You can help out by converting them to TypeScript!

**Viewing images offline**

There are a couple of things to migrate first until we can try to view images offline.

- [ ] Migrate from Redux-Wrapper to redux-toolkit and redux-query in the mobile code base
- [ ] Migrate from Redux to redux-toolkit and redux-query in the frontend code base
- [ ] Create a new package for the state management and nd API calls for the frontend and the mobile app (Single Sourcing)
- [ ] Implement step by step Asyc Storage for the stores (initial load, invalidating, partial fetching)

**Documentation**

Write docs for classes and functions and explain what they do, why it's there.
