# Release notes template

Every release body answers three questions before the technical part starts: what is new for me, do I
have to do anything, and how do I do it in the app. Readers include people who run the Windows app on
their own PC and have never opened a terminal, so the part above `**Upstream:**` is written for them.
Everything from `**Upstream:**` down is the house format used since 2026w25 and stays as it is.

Copy the skeleton, fill it in, then go through the checklist.

## Skeleton

```markdown
<Intro hook: one or two sentences in user words. No library or model names.>

**Who should update:** <Everyone | Everyone, multi-user instances right away because of security fixes>

**What's new for you:**

- <One sentence per highlight: what you can now do, with the UI label in bold. 3 to 5 bullets. Link the docs section.>

**Before you update:** <only when needed: backup reminder, minimum previous release, disk space>

**After you update:**

- **Nothing to do:** <what LibrePhotos does by itself, how long it takes, where to watch it>
- **Windows app:** <steps in the app first; a terminal step only when no button exists yet>
- **Docker:** <the same steps; commands for the standard and the single container setup>
- <Kubernetes and other admin-only details in a <details> block, or a link to upgrading.md>

**Upstream:**

🚀 <Area>: <Spotlight title>

<One paragraph per spotlight: what changed, why, link to the docs and the issue. (Implemented by [name](https://github.com/name)) for outside contributors.>

- ✨ <Area>: <new feature> ([#N](https://github.com/LibrePhotos/librephotos/issues/N)) (Implemented by [name](https://github.com/name))
- 🔨 <Area>: <fix>
- 🔒 <Area>: <security hardening>

**Full changelog:** https://github.com/LibrePhotos/librephotos/compare/<previous>...<this>

---

If you are interested in how I develop this application, you can watch me develop features live on **[my channel](https://www.youtube.com/channel/UCZJ2pk2BPKxwbuCV9LWDR0w)**

---

**Sponsoring development:**

My work is sponsored by **<N>** awesome <person | people>!

If you like the work I do, then you can support me via **[GitHub sponsors](https://github.com/sponsors/derneuere)** or via **[PayPal](https://www.paypal.com/donate/?hosted_button_id=5JWVM2UR4LM96)**
```

`<Area>` is `LibrePhotos` (several apps), `Backend`, `Frontend`, `Mobile` or `Docs`.

## Checklist

For "Who should update", "What's new for you", "Before you update" and "After you update":

- [ ] Each step says **who** (everyone, or "Admins:"), whether it is **required or optional**, **where** in the
      app, and **how the user knows it is done**.
- [ ] Each step says what happens if it is skipped.
- [ ] Work LibrePhotos does by itself is listed under **Nothing to do**, so it does not read like a task. When
      nothing has to be done at all, say so in one line.
- [ ] Paths through the app use the labels exactly as in `apps/frontend/src/locales/en/translation.json`,
      joined with `>`, for example **Account menu > Library**, then the arrow next to **Scan** > **Rescan**.
      Check every bold label against that file by hand.
- [ ] No command names, model names, migration numbers, issue or advisory ids, or error messages in these
      blocks. They belong in the spotlights and bullets below `**Upstream:**`. The only exception is a
      terminal step for which no button exists yet; give it with where to type it (see the example).
- [ ] Write "Windows app" for the standalone build, and "update" for what the user does. Keep "upgrade" only
      in links to docs anchors that already use it.
- [ ] Link a word from the [user glossary](https://docs.librephotos.com/docs/user-guide/glossary) the first
      time it is used, e.g. `[thumbnails](https://docs.librephotos.com/docs/user-guide/glossary#thumbnail)`.
      Add an entry to `apps/docs/docs/user-guide/glossary.md` when a release needs a word it does not have yet.
- [ ] One idea per sentence, about 20 words at most. Familiar words, key information first.
- [ ] No em dashes anywhere in the release body (house rule). Use a colon, a comma or a new sentence.
- [ ] Security: say who is affected and that they should update. Give no detail beyond the published advisory.
- [ ] Patch releases: one line under "Who should update" and the bullet list. Add "What's new for you" and
      "After you update" only when there is something new or something to do.
- [ ] Docs for new behaviour are on docs.librephotos.com, and their "not released yet" notes are removed or
      updated for this release.

## Worked example: 1.3.0

The 1.3.0 release body had its actions in an "After you upgrade" list that named the management command
first and did not say where to type it. Rewritten with this template:

```markdown
**Who should update:** Everyone. If other people use your LibrePhotos, or you share public links, update right away: this release fixes security problems.

**What's new for you:**

- Use the new **Filter** button on the timeline to hide screenshots and documents, or show only videos or favorites. **Save as default** keeps your choice.
- Videos that did not play in your browser before now play, for example iPhone videos in Firefox.
- If a photo is marked as a screenshot or document by mistake, fix it with the badge in the photo details.
- Search, scans and the app are faster and need less memory.

**After you update:**

- **Nothing to do for search and tags.** After the update, LibrePhotos reads every photo again in the background so that tags and search use the new model. Search finds more photos while this runs, and the **Things** albums fill up again. You can follow it under **Account menu > My Jobs**.
- **Admins: remove photo details from old thumbnails once. Recommended for everyone, required if you use public links.** Thumbnails made before 1.3.0 still contain the location and camera details of the photo, and public links show those thumbnails. One cleanup removes that data. Your photos and the thumbnails' pictures stay as they are, and running it twice does no harm.
  - **Windows app:** open the folder that contains `librephotos.exe`. Click the address bar of the folder window, type `cmd` and press Enter. In the black window, paste `start /wait librephotos.exe manage strip_thumbnail_metadata` and press Enter. If you start LibrePhotos with `--data-dir`, put the same `--data-dir <folder>` right after `librephotos.exe`. It is done when the window shows the prompt again.
  - **Docker:** in the folder with your `docker-compose.yml`, run `docker compose exec backend python manage.py strip_thumbnail_metadata`. Single container: `docker exec librephotos python manage.py strip_thumbnail_metadata`.
  - More detail: [After upgrading from 1.2.1 or older](https://docs.librephotos.com/docs/installation/upgrading#strip-thumbnail-metadata).
- <details><summary>Kubernetes</summary>The manifests in deploy/k8s now use 1.3.0 and PostgreSQL 16 instead of 2023w31 and PostgreSQL 13. Read the Kubernetes README before you apply them to an existing install.</details>
```

### Once there is a button for every step

#2321 makes the thumbnail cleanup a job, and #2322 adds a **Finish the upgrade** card to the Admin Area.
Neither has shipped yet, so the labels below are placeholders; use whatever those issues ship. If the
cleanup then runs by itself (option A in #2322), the terminal step disappears and the whole block becomes:

```markdown
**After you update:**

- **Nothing to do.** After the update, LibrePhotos reads every photo again in the background so that tags and search use the new model, and removes the photo details from old thumbnails. Admins can follow both on the **Finish the upgrade** card under **Account menu > Admin Area**. This is the same on the Windows app and on Docker.
```

If #2322 settles on a button instead (option B), the thumbnail part stays its own bullet:
"**Admins:** go to **Account menu > Admin Area** and click **Start** next to **Remove photo details from old
thumbnails** on the **Finish the upgrade** card."
