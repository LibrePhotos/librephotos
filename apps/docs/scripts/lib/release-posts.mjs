// Release posts: one blog post per release (apps/docs/blog/YYYY-MM-DD-<tag>.md) is the source of
// the GitHub release body (release-body.mjs), of src/data/releases.json (build-releases.mjs, read by
// <Since> and the landing page) and of the in-app "What's new" card. This module reads, validates
// and converts them; the scripts next to it are thin command-line wrappers.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import { compareVersions, isPatchRelease, sinceState } from "../../src/data/releases.ts";

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BLOG_DIR = path.join(DOCS_DIR, "blog");
export const SHOTS_DIR = path.join(DOCS_DIR, "static", "img", "shots");
export const RELEASES_JSON = path.join(DOCS_DIR, "src", "data", "releases.json");
export const SITE_URL = "https://docs.librephotos.com";

/** Posts for this release and later follow .github/release-notes-template.md and get every check. */
export const TEMPLATE_SINCE = "1.3.0";

const EM_DASH = "\u2014";
const WHO_SHOULD_UPDATE = /^(\*\*Who should update:\*\*|#{2,3} Who should update)/m;
const WHATS_NEW = /^(\*\*What's new for you:\*\*|#{2,3} What's new for you)/m;
const UPSTREAM = /^\*\*Upstream:\*\*$/m;

/**
 * The post's URL is /blog/<slug>. Dots are left out because a dotted last path segment looks like a
 * file name: `docusaurus start` and `docusaurus serve` answer 404 for /blog/1.3.0.
 */
export function releaseSlug(release) {
  return release.replaceAll(".", "-");
}

const version = z.string().regex(/^\d+\.\d+\.\d+$/, "must be a version like 1.4.0");
const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case");
const sitePath = z.string().regex(/^\/(?!\/)/, "must be a path on the site, starting with /");

export const highlightSchema = z.strictObject({
  id: kebab,
  audience: z.enum(["all", "admin"]),
  title: z.string().min(1).max(60),
  body: z.string().min(1).max(240),
  shot: kebab.optional(),
  learn_more: z.string().regex(/^\/docs\/[^#\s]+(#[\w-]+)?$/, "must be a /docs/ path, optionally with #anchor"),
  open_in_app: sitePath.optional(),
});

export const releaseFrontMatterSchema = z
  .strictObject({
    slug: z.string(),
    title: z.string().min(1),
    authors: z.array(z.string()).min(1),
    tags: z.array(z.string()).refine((tags) => tags.includes("release"), "must include release"),
    date: z.date(),
    release: version,
    covers: z.array(version).optional(),
    summary: z.string().min(1).max(240),
    highlights: z.array(highlightSchema).min(1).max(6).optional(),
  })
  .superRefine((fm, ctx) => {
    if (fm.slug !== releaseSlug(fm.release)) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: `must be "${releaseSlug(fm.release)}"` });
    }
    if (!fm.title.startsWith(`${fm.release} `) && !fm.title.startsWith(`${fm.release}:`)) {
      ctx.addIssue({ code: "custom", path: ["title"], message: `must start with the release, "${fm.release}"` });
    }
    for (const covered of fm.covers ?? []) {
      if (compareVersions(covered, fm.release) <= 0) {
        ctx.addIssue({ code: "custom", path: ["covers"], message: `${covered} is not newer than ${fm.release}` });
      }
    }
    const ids = (fm.highlights ?? []).map((h) => h.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["highlights"], message: "ids must be unique" });
    }
  });

/** Splits `---\nyaml\n---\nbody` into its parts. */
export function parseFrontMatter(source) {
  const text = source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) {
    return { data: {}, body: text };
  }
  return { data: yaml.load(match[1]) ?? {}, body: text.slice(match[0].length) };
}

/** Every blog post with `release:` in its front matter. The weekly posts before 1.0.0 have none. */
export function readReleasePosts(blogDir = BLOG_DIR) {
  return fs
    .readdirSync(blogDir)
    .filter((name) => /\.mdx?$/.test(name))
    .map((name) => ({ file: name, ...parseFrontMatter(fs.readFileSync(path.join(blogDir, name), "utf8")) }))
    .filter((post) => post.data.release !== undefined);
}

/**
 * Known screenshots as id -> alt text: the #2307 manifest (static/img/shots/manifest.json) when
 * there is one, else every `<id>-light.webp` that has a `<id>-dark.webp` twin (no alt text).
 */
export function readShots(shotsDir = SHOTS_DIR) {
  if (!fs.existsSync(shotsDir)) {
    return new Map();
  }
  const manifest = path.join(shotsDir, "manifest.json");
  if (fs.existsSync(manifest)) {
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : (parsed.shots ?? Object.values(parsed));
    return new Map(entries.map((entry) => [entry.id, entry.alt ?? ""]));
  }
  const files = new Set(fs.readdirSync(shotsDir));
  return new Map(
    [...files]
      .filter((name) => name.endsWith("-light.webp"))
      .map((name) => name.slice(0, -"-light.webp".length))
      .filter((id) => files.has(`${id}-dark.webp`))
      .map((id) => [id, ""]),
  );
}

/** One entry of static/img/shots/manifest.json, read by the <Screenshot> component (src/data/shots.ts). */
export const shotSchema = z.strictObject({
  id: kebab,
  alt: z.string().trim().min(1, "needs alt text that says what the shot shows"),
  width: z.int().positive(),
  height: z.int().positive(),
  release: version.optional(),
  /** Size of the phone variant, `<id>-phone-light.webp` and `<id>-phone-dark.webp`, when there is one. */
  phone: z.strictObject({ width: z.int().positive(), height: z.int().positive() }).optional(),
});

const SHOT_FILE = /-(light|dark)\.webp$/;

function manifestIssue(raw, issue) {
  const [index, ...field] = issue.path;
  const where = typeof index === "number" ? `entry ${index} ("${raw[index]?.id ?? "?"}")` : "(root)";
  return `manifest.json ${[where, ...field].join(" ")}: ${issue.message}`;
}

/** The parsed manifest, or the problems that stop it from being read. */
function readShotsManifest(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { errors: [`manifest.json: ${error.message}`] };
  }
  const parsed = z.array(shotSchema).safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => manifestIssue(raw, issue)) };
  }
  return { shots: parsed.data, errors: [] };
}

function duplicateShotErrors(shots) {
  const ids = shots.map((s) => s.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].map((id) => `manifest.json: "${id}" is listed twice`);
}

/** The files a manifest entry needs: `<id>-light.webp` and `<id>-dark.webp`, and the phone pair with `phone`. */
function shotFiles(shot) {
  const stems = shot.phone ? [shot.id, `${shot.id}-phone`] : [shot.id];
  return stems.flatMap((stem) => ["light", "dark"].map((theme) => `${stem}-${theme}.webp`));
}

function missingShotFileErrors(shots, files) {
  return shots.flatMap((shot) =>
    shotFiles(shot)
      .filter((name) => !files.has(name))
      .map((name) => `manifest.json "${shot.id}": ${name} is missing`),
  );
}

function unlistedShotFileErrors(shots, files) {
  const listed = new Set(shots.flatMap(shotFiles));
  return [...files]
    .filter((name) => SHOT_FILE.test(name) && !listed.has(name))
    .map((name) => `${name} has no entry in manifest.json`);
}

/**
 * Problems of static/img/shots: every manifest entry needs alt text and a light and a dark file
 * (and the phone pair when it has `phone`), and every `*-light.webp`/`*-dark.webp` needs an entry.
 * The screens run (apps/frontend/e2e, `yarn screens`) writes the files and the manifest.
 */
export function shotsErrors(shotsDir = SHOTS_DIR) {
  if (!fs.existsSync(shotsDir)) {
    return [];
  }
  const manifest = path.join(shotsDir, "manifest.json");
  if (!fs.existsSync(manifest)) {
    return ["static/img/shots/manifest.json is missing"];
  }
  const { shots, errors } = readShotsManifest(manifest);
  if (!shots) {
    return errors;
  }
  const files = new Set(fs.readdirSync(shotsDir));
  return [...duplicateShotErrors(shots), ...missingShotFileErrors(shots, files), ...unlistedShotFileErrors(shots, files)];
}

/** Shot ids a post uses: highlight `shot`s and `<Screenshot id="...">` in the body. */
export function shotIdsInPost(post) {
  const ids = (post.data.highlights ?? []).map((h) => h.shot).filter(Boolean);
  for (const match of post.body.matchAll(/<Screenshot\b[^>]*\bid="([^"]+)"/g)) {
    ids.push(match[1]);
  }
  return ids;
}

function formatIssues(error) {
  return error.issues.map((issue) => `front matter ${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

function bodyErrors(post) {
  const errors = [];
  const { release } = post.data;
  if (compareVersions(release, TEMPLATE_SINCE) < 0) {
    return errors;
  }
  if (!WHO_SHOULD_UPDATE.test(post.body)) {
    errors.push('missing "**Who should update:**"');
  }
  if (!isPatchRelease(release) && !WHATS_NEW.test(post.body)) {
    errors.push(`missing "**What's new for you:**" (required for ${release}, which is not a patch release)`);
  }
  if (!isPatchRelease(release) && !post.data.highlights) {
    errors.push(`front matter highlights: required for ${release}, which is not a patch release`);
  }
  if (!UPSTREAM.test(post.body)) {
    errors.push('missing "**Upstream:**"');
  }
  return errors;
}

/** Problems of one post, as human-readable strings (empty when the post is fine). */
export function validatePost(post, shots) {
  const parsed = releaseFrontMatterSchema.safeParse(post.data);
  if (!parsed.success) {
    return formatIssues(parsed.error);
  }
  const errors = [];
  const raw = `${JSON.stringify(post.data)}\n${post.body}`;
  if (raw.includes(EM_DASH)) {
    errors.push("contains an em dash (house rule: use a colon, a comma or a new sentence)");
  }
  for (const id of shotIdsInPost(post)) {
    if (!shots.has(id)) {
      errors.push(`unknown shot id "${id}" (not in static/img/shots)`);
    }
  }
  return [...errors, ...bodyErrors(post)];
}

/** Problems across posts: one post per release tag. */
export function validateCollection(posts) {
  const seen = new Map();
  const errors = [];
  for (const post of posts) {
    for (const tag of [post.data.release, ...(post.data.covers ?? [])]) {
      if (seen.has(tag)) {
        errors.push(`${post.file}: ${tag} is already covered by ${seen.get(tag)}`);
      }
      seen.set(tag, post.file);
    }
  }
  return errors;
}

/** src/data/releases.json: what <Since>, the landing page and the app read. */
export function buildReleaseIndex(posts) {
  const releases = posts
    .map(({ data }) => ({
      release: data.release,
      versions: [data.release, ...(data.covers ?? [])],
      date: data.date.toISOString(),
      title: data.title,
      permalink: `/blog/${data.slug}`,
      summary: data.summary,
      highlights: data.highlights ?? [],
    }))
    .sort((a, b) => compareVersions(b.release, a.release));
  const latest = releases.flatMap((r) => r.versions).sort(compareVersions).at(-1);
  return { latest, releases };
}

export function serializeReleaseIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function absolute(url) {
  return url.startsWith("/") && !url.startsWith("//") ? `${SITE_URL}${url}` : url;
}

function screenshotHtml(attributes, shots) {
  const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
  const alt = /\balt="([^"]*)"/.exec(attributes)?.[1] ?? shots.get(id) ?? "";
  const base = `${SITE_URL}/img/shots/${id}`;
  return [
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="${base}-dark.webp">`,
    `  <img src="${base}-light.webp" alt="${alt}">`,
    "</picture>",
  ].join("\n");
}

/**
 * The post as GitHub release Markdown: front matter, imports and the truncate marker dropped,
 * `<Screenshot>` turned into a light/dark `<picture>`, `<Since>` into plain text, site-relative
 * links and images made absolute, and a last line that links the post.
 */
export function toGithubMarkdown(post, shots = new Map()) {
  const body = post.body
    .replace(/^import .*$\n?/gm, "")
    .replace(/^\s*<!--\s*truncate\s*-->\s*$\n?/gm, "")
    .replace(/<Screenshot\b([^>]*?)\/>/g, (_, attributes) => screenshotHtml(attributes, shots))
    .replace(/<Since\s+version="([^"]+)"\s*\/>/g, "(new in $1)")
    .replace(/\]\((\/[^)\s]*)\)/g, (_, url) => `](${absolute(url)})`)
    .replace(/\b(src|srcset|href)="(\/[^"]*)"/g, (_, attr, url) => `${attr}="${absolute(url)}"`)
    .trim();
  return `${body}\n\n**Read this release on the docs site:** ${SITE_URL}/blog/${post.data.slug}\n`;
}

/** Internal links the release posts promise, as `/docs/...#anchor` paths, for the post-build check. */
export function linksToVerify(posts) {
  const links = new Set();
  for (const post of posts) {
    for (const highlight of post.data.highlights ?? []) {
      links.add(highlight.learn_more);
    }
    for (const match of post.body.matchAll(/\]\((?:https:\/\/docs\.librephotos\.com)?(\/docs\/[^)\s]+)\)/g)) {
      links.add(match[1]);
    }
  }
  return [...links].sort();
}

/** Every problem of the posts and of src/data/releases.json, before the build. */
export function sourceErrors(posts, shots = readShots(), releasesJson = RELEASES_JSON) {
  const errors = posts.flatMap((post) => validatePost(post, shots).map((e) => `${post.file}: ${e}`));
  errors.push(...validateCollection(posts));
  if (errors.length === 0) {
    const expected = serializeReleaseIndex(buildReleaseIndex(posts));
    const actual = fs.existsSync(releasesJson) ? fs.readFileSync(releasesJson, "utf8").replace(/\r\n/g, "\n") : "";
    if (actual !== expected) {
      errors.push("src/data/releases.json is out of date: run `node scripts/build-releases.mjs` and commit it");
    }
  }
  return errors;
}

function pageHtml(buildDir, pagePath) {
  const clean = pagePath.replace(/^\/+|\/+$/g, "");
  for (const candidate of [path.join(buildDir, clean, "index.html"), path.join(buildDir, `${clean}.html`)]) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  return undefined;
}

function linkErrors(buildDir, posts) {
  const errors = [];
  for (const link of linksToVerify(posts)) {
    const [pagePath, anchor] = link.split("#");
    const html = pageHtml(buildDir, pagePath);
    if (html === undefined) {
      errors.push(`${link}: no such page in the build`);
    } else if (anchor && !html.includes(`id="${anchor}"`)) {
      errors.push(`${link}: the page has no #${anchor}`);
    }
  }
  return errors;
}

function* htmlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

function sinceErrors(buildDir, index) {
  const errors = [];
  const counts = { released: 0, unreleased: 0, errors };
  for (const file of htmlFiles(buildDir)) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/data-since="([^"]+)"[^>]*?data-released="(true|false)"/g)) {
      const expected = sinceState(match[1], index).released;
      counts[expected ? "released" : "unreleased"] += 1;
      if (String(expected) !== match[2]) {
        errors.push(`${path.relative(buildDir, file)}: <Since version="${match[1]}"> rendered released=${match[2]}`);
      }
    }
  }
  return counts;
}

/**
 * Problems in the built site: links the posts promise (learn_more, docs links) must reach a page
 * and anchor, and every rendered <Since> badge must match releases.json. Also counts the badges.
 */
export function buildErrors(buildDir, posts) {
  const since = sinceErrors(buildDir, buildReleaseIndex(posts));
  return { ...since, errors: [...linkErrors(buildDir, posts), ...since.errors] };
}
