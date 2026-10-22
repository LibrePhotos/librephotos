// node --test "scripts/**/*.test.mjs" (from apps/docs)

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  RELEASES_JSON,
  buildErrors,
  buildReleaseIndex,
  linksToVerify,
  parseFrontMatter,
  readReleasePosts,
  readShots,
  releaseSlug,
  serializeReleaseIndex,
  shotsErrors,
  sourceErrors,
  toGithubMarkdown,
  validateCollection,
  validatePost,
} from "./lib/release-posts.mjs";
import { compareVersions, sinceLabel, sinceState } from "../src/data/releases.ts";

const TEMPLATE_BODY = [
  "Intro.",
  "",
  "**Who should update:** Everyone.",
  "",
  "**What's new for you:**",
  "",
  "- Something.",
  "",
  "**Upstream:**",
  "",
  "- ✨ Frontend: Something",
  "",
].join("\n");

function post({ release = "1.4.0", body = TEMPLATE_BODY, ...data } = {}) {
  return {
    file: `2026-11-01-${release}.md`,
    data: {
      slug: releaseSlug(release),
      title: `${release}: Something new`,
      authors: ["niaz"],
      tags: ["release"],
      date: new Date("2026-11-01T10:00:00Z"),
      release,
      summary: "One sentence.",
      highlights: [
        { id: "thing", audience: "all", title: "A thing", body: "Does things.", learn_more: "/docs/user-guide/search" },
      ],
      ...data,
    },
    body,
  };
}

const NO_SHOTS = new Map();

describe("parseFrontMatter", () => {
  it("splits YAML front matter from the body and keeps dates as dates", () => {
    const { data, body } = parseFrontMatter('---\nrelease: "1.3.0"\ndate: 2026-10-11T11:36:15Z\n---\n\nHello\n');
    assert.equal(data.release, "1.3.0");
    assert.ok(data.date instanceof Date);
    assert.equal(body, "\nHello\n");
  });

  it("handles CRLF files and files without front matter", () => {
    assert.equal(parseFrontMatter("---\r\na: 1\r\n---\r\nx").data.a, 1);
    assert.deepEqual(parseFrontMatter("just text").data, {});
  });
});

describe("validatePost", () => {
  it("accepts a post in the template format", () => {
    assert.deepEqual(validatePost(post(), NO_SHOTS), []);
  });

  it("rejects an em dash in the body or the front matter", () => {
    assert.match(validatePost(post({ body: `${TEMPLATE_BODY}A \u2014 B\n` }), NO_SHOTS).join(), /em dash/);
    assert.match(validatePost(post({ summary: "A \u2014 B" }), NO_SHOTS).join(), /em dash/);
  });

  it("requires Who should update, What's new for you and Upstream from 1.3.0 on", () => {
    const errors = validatePost(post({ body: "Just text.\n" }), NO_SHOTS).join("\n");
    assert.match(errors, /Who should update/);
    assert.match(errors, /What's new for you/);
    assert.match(errors, /Upstream/);
  });

  it("accepts the headings as Markdown headings too", () => {
    const body = "## Who should update\n\nEveryone.\n\n## What's new for you\n\n- x\n\n**Upstream:**\n";
    assert.deepEqual(validatePost(post({ body }), NO_SHOTS), []);
  });

  it("lets a patch release go without What's new for you and highlights", () => {
    const body = "**Who should update:** SQLite users.\n\n**Upstream:**\n\n- 🔨 Backend: Fix\n";
    assert.deepEqual(validatePost(post({ release: "1.4.1", body, highlights: undefined }), NO_SHOTS), []);
  });

  it("requires highlights for a minor release", () => {
    assert.match(validatePost(post({ highlights: undefined }), NO_SHOTS).join(), /highlights: required/);
  });

  it("skips the template checks for posts older than 1.3.0, but not the em dash check", () => {
    assert.deepEqual(validatePost(post({ release: "1.2.0", body: "Old format.\n" }), NO_SHOTS), []);
    assert.match(validatePost(post({ release: "1.2.0", body: "A \u2014 B\n" }), NO_SHOTS).join(), /em dash/);
  });

  it("rejects unknown shot ids in highlights and in <Screenshot>", () => {
    const highlights = [{ id: "a", audience: "all", title: "A", body: "B", shot: "nope", learn_more: "/docs/x" }];
    const body = `${TEMPLATE_BODY}<Screenshot id="missing" />\n`;
    const errors = validatePost(post({ highlights, body }), new Map([["timeline", ""]])).join("\n");
    assert.match(errors, /unknown shot id "nope"/);
    assert.match(errors, /unknown shot id "missing"/);
    assert.deepEqual(validatePost(post({ body: `${TEMPLATE_BODY}<Screenshot id="timeline" />\n` }), new Map([["timeline", ""]])), []);
  });

  it("validates the front matter with the schema", () => {
    const errors = validatePost(
      post({
        slug: "1.4.0",
        title: "Something new",
        release: "1.4",
        tags: ["news"],
        extra: true,
        highlights: [{ id: "Not Kebab", audience: "everyone", title: "", body: "x", learn_more: "https://example.com" }],
      }),
      NO_SHOTS,
    ).join("\n");
    assert.match(errors, /Unrecognized key: "extra"/);
    for (const field of ["release", "tags", "highlights.0.id", "highlights.0.audience", "highlights.0.title", "highlights.0.learn_more"]) {
      assert.match(errors, new RegExp(`front matter ${field.replace(".", "\\.")}`), field);
    }
  });

  it("checks slug, title prefix, covers and unique highlight ids", () => {
    const h = { id: "same", audience: "all", title: "A", body: "B", learn_more: "/docs/x" };
    const errors = validatePost(
      post({ slug: "1.4.0", title: "Something", covers: ["1.3.0"], highlights: [h, h] }),
      NO_SHOTS,
    ).join("\n");
    assert.match(errors, /slug: must be "1-4-0"/);
    assert.match(errors, /title: must start with the release/);
    assert.match(errors, /covers: 1.3.0 is not newer than 1.4.0/);
    assert.match(errors, /highlights: ids must be unique/);
  });
});

describe("validateCollection", () => {
  it("rejects two posts for the same release", () => {
    const errors = validateCollection([post({ release: "1.4.0" }), post({ release: "1.3.0", covers: ["1.4.0"] })]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /1.4.0 is already covered/);
  });
});

describe("buildReleaseIndex", () => {
  it("sorts newest first and takes latest from every covered tag", () => {
    const index = buildReleaseIndex([
      post({ release: "1.0.0", covers: ["1.0.1", "1.0.2"], highlights: undefined }),
      post({ release: "1.10.0" }),
      post({ release: "1.2.0" }),
    ]);
    assert.deepEqual(
      index.releases.map((r) => r.release),
      ["1.10.0", "1.2.0", "1.0.0"],
    );
    assert.equal(index.latest, "1.10.0");
    assert.deepEqual(index.releases[2].versions, ["1.0.0", "1.0.1", "1.0.2"]);
    assert.deepEqual(index.releases[2].highlights, []);
    assert.equal(index.releases[0].permalink, "/blog/1-10-0");
    assert.equal(index.releases[0].date, "2026-11-01T10:00:00.000Z");
  });
});

describe("toGithubMarkdown", () => {
  it("drops MDX-only parts, makes site links absolute and links the post", () => {
    const body = [
      "import Foo from '@site/src/foo';",
      "Intro.",
      "<!-- truncate -->",
      '<Screenshot id="timeline-filter" />',
      'Filter <Since version="1.4.0" /> here, see [the docs](/docs/user-guide/search#filters) and [GitHub](https://github.com).',
      "![A map](/img/map.webp)",
      '<a href="/blog">all</a>',
    ].join("\n");
    const out = toGithubMarkdown(post({ body }), new Map([["timeline-filter", "The Filter popover"]]));
    assert.doesNotMatch(out, /import|truncate|<Screenshot|<Since/);
    assert.match(out, /srcset="https:\/\/docs\.librephotos\.com\/img\/shots\/timeline-filter-dark\.webp"/);
    assert.match(out, /<img src="https:\/\/docs\.librephotos\.com\/img\/shots\/timeline-filter-light\.webp" alt="The Filter popover">/);
    assert.match(out, /Filter \(new in 1\.4\.0\) here/);
    assert.match(out, /\[the docs\]\(https:\/\/docs\.librephotos\.com\/docs\/user-guide\/search#filters\)/);
    assert.match(out, /\[GitHub\]\(https:\/\/github\.com\)/);
    assert.match(out, /!\[A map\]\(https:\/\/docs\.librephotos\.com\/img\/map\.webp\)/);
    assert.match(out, /href="https:\/\/docs\.librephotos\.com\/blog"/);
    assert.ok(out.startsWith("Intro."));
    assert.ok(out.endsWith("**Read this release on the docs site:** https://docs.librephotos.com/blog/1-4-0\n"));
  });

  it("prefers the alt text given on the component", () => {
    const out = toGithubMarkdown(post({ body: '<Screenshot id="x" alt="Mine" />' }), new Map([["x", "Manifest"]]));
    assert.match(out, /alt="Mine"/);
  });
});

describe("linksToVerify", () => {
  it("collects learn_more paths and docs links of the body, absolute or not", () => {
    const body = "[a](https://docs.librephotos.com/docs/a#x) [b](/docs/b) [c](https://github.com/x)";
    assert.deepEqual(linksToVerify([post({ body })]), ["/docs/a#x", "/docs/b", "/docs/user-guide/search"]);
  });
});

describe("readShots", () => {
  it("lists ids with a light and a dark file, or reads the manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
    try {
      for (const name of ["a-light.webp", "a-dark.webp", "b-light.webp"]) {
        fs.writeFileSync(path.join(dir, name), "");
      }
      assert.deepEqual([...readShots(dir).keys()], ["a"]);
      fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify([{ id: "c", alt: "C shot" }]));
      assert.deepEqual([...readShots(dir)], [["c", "C shot"]]);
      assert.equal(readShots(path.join(dir, "missing")).size, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shotsErrors", () => {
  const entry = (id, extra = {}) => ({ id, alt: `${id} shot`, width: 1600, height: 1000, ...extra });

  function shotsDir(t, manifest, files) {
    const dir = tempDir(t);
    for (const name of files) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    if (manifest !== undefined) {
      fs.writeFileSync(path.join(dir, "manifest.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    }
    return dir;
  }

  it("accepts a manifest whose entries have alt text and both files", (t) => {
    const dir = shotsDir(t, [entry("a"), entry("b", { release: "1.4.0" })], ["a-light.webp", "a-dark.webp", "b-light.webp", "b-dark.webp", "CREDITS.md"]);
    assert.deepEqual(shotsErrors(dir), []);
  });

  it("rejects an entry without alt text, naming the entry", (t) => {
    const files = ["a-light.webp", "a-dark.webp", "b-light.webp", "b-dark.webp"];
    const dir = shotsDir(t, [entry("a", { alt: " " }), { id: "b", width: 1, height: 1 }, { alt: "x", width: 1, height: 1 }], files);
    const errors = shotsErrors(dir);
    assert.equal(errors.length, 3);
    assert.match(errors[0], /^manifest\.json entry 0 \("a"\) alt: needs alt text/);
    assert.match(errors[1], /^manifest\.json entry 1 \("b"\) alt:/);
    assert.match(errors[2], /^manifest\.json entry 2 \("\?"\) id:/);
  });

  it("rejects a missing light or dark file", (t) => {
    const dir = shotsDir(t, [entry("a"), entry("b")], ["a-light.webp", "b-dark.webp"]);
    assert.deepEqual(shotsErrors(dir), [
      'manifest.json "a": a-dark.webp is missing',
      'manifest.json "b": b-light.webp is missing',
    ]);
  });

  it("asks for both phone files of an entry with a phone size, and for an entry for phone files", (t) => {
    const phone = { phone: { width: 412, height: 839 } };
    const files = ["a-light.webp", "a-dark.webp", "a-phone-light.webp", "b-light.webp", "b-dark.webp", "b-phone-dark.webp"];
    assert.deepEqual(shotsErrors(shotsDir(t, [entry("a", phone), entry("b")], files)), [
      'manifest.json "a": a-phone-dark.webp is missing',
      "b-phone-dark.webp has no entry in manifest.json",
    ]);
    assert.match(shotsErrors(shotsDir(t, [entry("a", { phone: { width: 0, height: 1 } })], files)).join(), /entry 0 \("a"\) phone width:/);
  });

  it("rejects a shot file without a manifest entry", (t) => {
    const dir = shotsDir(t, [entry("a")], ["a-light.webp", "a-dark.webp", "c-light.webp", "d-dark.webp"]);
    assert.deepEqual(shotsErrors(dir), ["c-light.webp has no entry in manifest.json", "d-dark.webp has no entry in manifest.json"]);
  });

  it("rejects duplicate ids, unknown fields and a manifest that is not a list", (t) => {
    const files = ["a-light.webp", "a-dark.webp"];
    assert.deepEqual(shotsErrors(shotsDir(t, [entry("a"), entry("a")], files)), ['manifest.json: "a" is listed twice']);
    assert.match(shotsErrors(shotsDir(t, [entry("a", { zoom: true })], files)).join(), /entry 0 \("a"\): Unrecognized key/);
    assert.match(shotsErrors(shotsDir(t, { a: entry("a") }, files)).join(), /^manifest\.json \(root\): /);
  });

  it("asks for a manifest and reports one that is not JSON", (t) => {
    assert.deepEqual(shotsErrors(shotsDir(t, undefined, ["a-light.webp"])), ["static/img/shots/manifest.json is missing"]);
    assert.match(shotsErrors(shotsDir(t, "{ nope", [])).join(), /^manifest\.json: /);
    assert.deepEqual(shotsErrors(path.join(tempDir(t), "missing")), []);
  });
});

describe("Since", () => {
  const index = buildReleaseIndex([post({ release: "1.3.0" }), post({ release: "1.0.0", covers: ["1.0.1"] })]);

  it("says New in for a released version and links its post", () => {
    const state = sinceState("1.0.1", index);
    assert.deepEqual(state, { released: true, version: "1.0.1", permalink: "/blog/1-0-0" });
    assert.equal(sinceLabel(state), "New in 1.0.1");
  });

  it("says Not released yet for a version after the latest", () => {
    const state = sinceState("1.4.0", index);
    assert.deepEqual(state, { released: false, version: "1.4.0", latest: "1.3.0" });
    assert.equal(sinceLabel(state), "Not released yet (comes after 1.3.0)");
  });

  it("fails the build for a malformed version or an old version without a post", () => {
    assert.throws(() => sinceState("1.4", index), /not a release version/);
    assert.throws(() => sinceState("1.2.0", index), /has no release post/);
  });

  it("compares versions numerically", () => {
    assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
    assert.equal(compareVersions("1.3.0", "1.3.0"), 0);
  });
});

describe("the release posts in blog/", () => {
  const posts = readReleasePosts();

  it("pass every check", () => {
    const shots = readShots();
    assert.deepEqual(posts.flatMap((p) => validatePost(p, shots).map((e) => `${p.file}: ${e}`)), []);
    assert.deepEqual(validateCollection(posts), []);
  });

  it("use shots that pass the shots check", () => {
    assert.deepEqual(shotsErrors(), []);
  });

  it("match src/data/releases.json", () => {
    const actual = fs.readFileSync(RELEASES_JSON, "utf8").replace(/\r\n/g, "\n");
    assert.equal(actual, serializeReleaseIndex(buildReleaseIndex(posts)));
  });
});

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-posts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe("sourceErrors", () => {
  const posts = [post({ release: "1.3.0" })];

  it("passes when releases.json matches the posts", (t) => {
    const json = path.join(tempDir(t), "releases.json");
    fs.writeFileSync(json, serializeReleaseIndex(buildReleaseIndex(posts)).replace(/\n/g, "\r\n"));
    assert.deepEqual(sourceErrors(posts, NO_SHOTS, json), []);
  });

  it("asks to regenerate a stale or missing releases.json", (t) => {
    const dir = tempDir(t);
    const json = path.join(dir, "releases.json");
    fs.writeFileSync(json, "{}\n");
    assert.match(sourceErrors(posts, NO_SHOTS, json).join(), /out of date/);
    assert.match(sourceErrors(posts, NO_SHOTS, path.join(dir, "none.json")).join(), /out of date/);
  });

  it("reports post problems with the file name and skips the JSON check then", (t) => {
    const errors = sourceErrors([post({ summary: "A \u2014 B" })], NO_SHOTS, path.join(tempDir(t), "none.json"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^2026-11-01-1\.4\.0\.md: contains an em dash/);
  });
});

describe("buildErrors", () => {
  const posts = [post({ release: "1.3.0", body: `${TEMPLATE_BODY}[up](https://docs.librephotos.com/docs/up#gone)\n` })];

  it("checks the promised pages and anchors, and the rendered <Since> badges", (t) => {
    const build = tempDir(t);
    writeFile(path.join(build, "docs/user-guide/search/index.html"), '<h2 id="x">x</h2>');
    writeFile(path.join(build, "docs/up.html"), '<h2 id="here">here</h2>');
    writeFile(
      path.join(build, "docs/a/index.html"),
      '<a class="s" data-since="1.3.0" data-released="true">New</a><span data-since="1.4.0" data-released="true">x</span>',
    );
    writeFile(path.join(build, "docs/b/index.html"), '<span data-since="1.4.0" data-released="false">Not yet</span>');
    writeFile(path.join(build, "styles.css"), "");
    const result = buildErrors(build, posts);
    assert.equal(result.released, 1);
    assert.equal(result.unreleased, 2);
    assert.deepEqual(result.errors, [
      "/docs/up#gone: the page has no #gone",
      `${path.join("docs", "a", "index.html")}: <Since version="1.4.0"> rendered released=true`,
    ]);
  });

  it("reports a page that is missing from the build", (t) => {
    assert.deepEqual(buildErrors(tempDir(t), [post({ release: "1.3.0" })]).errors, [
      "/docs/user-guide/search: no such page in the build",
    ]);
  });
});
