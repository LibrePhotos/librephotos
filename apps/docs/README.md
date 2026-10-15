# LibrePhotos Docs

This website is built using [Docusaurus 3](https://docusaurus.io/), a modern static website generator.

### Installation

```
$ yarn
```

### Local Development

```
$ yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```
$ yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Release posts

Every release has a post in `blog/` (`YYYY-MM-DD-<tag>.md`). It is the source of the GitHub release body,
of `src/data/releases.json` (the "New in" block on the landing page and the `<Since>` markers) and of the
in-app "What's new" card. Format, front matter and release steps: `.github/release-notes-template.md`.

```
$ node scripts/build-releases.mjs           # regenerate src/data/releases.json, commit it
$ node scripts/check-release-posts.mjs      # front matter, em dashes, required blocks (CI runs it)
$ node scripts/release-body.mjs 1.3.0       # print the GitHub release body
$ node --test "scripts/**/*.test.mjs"       # tests of the scripts
```

### Marking features that are not released yet

Docs deploy from `dev`, so a page can describe a feature before its release. Mark it with
`<Since version="1.4.0" />` (no import needed) on the line under the heading, or at the start of a note
(`:::note` and on the next line `<Since version="1.4.0" /> Up to 1.3.0, ...`). Next to text in an
admonition title it works too (`:::note[Star ratings <Since version="1.3.0" />]`), but not alone there. It shows "Not released yet (comes after 1.3.0)" until the 1.4.0
release post is merged and `releases.json` regenerated, then "New in 1.4.0" with a link to the post.
A version that is not newer than the latest release and has no post fails the build.

### Deployment

Using SSH:

```
$ USE_SSH=true yarn deploy
```

Not using SSH:

```
$ GIT_USER=<Your GitHub username> yarn deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.
