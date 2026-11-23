// Walk every major screen of the React frontend against one backend and record,
// per step, console errors, page errors, failed requests, toasts (zod parse
// failures included) and a screenshot. Run it once per backend, then diff.mjs.
//
//   node walk.mjs <frontend_url> <label> [out_dir]
//
// The frontend is a Vite dev server whose VITE_BACKEND_URL points at the
// backend under test. Mutating steps (upload, favorite, album create/rename/
// delete, face label) need a clone with its own media copy.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [frontend, label, outArg] = process.argv.slice(2);
if (!frontend || !label) {
  console.error("usage: node walk.mjs <frontend_url> <label> [out_dir]");
  process.exit(2);
}
const outDir = path.resolve(outArg ?? path.join("out", label));
const shotDir = path.join(outDir, "shots");
fs.mkdirSync(shotDir, { recursive: true });

const manifestPath = process.env.LP_MANIFEST ?? "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fixtureRoot = manifest.base_data ?? "C:/Users/Niaz/librephotos/rust-pg/fixture";

const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS ?? 1500);
const steps = [];
let current = null;

function trackPage(page) {
  page.on("console", msg => {
    if (current && msg.type() === "error") current.consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", err => {
    if (current) current.pageErrors.push(String(err?.message ?? err).slice(0, 500));
  });
  page.on("response", res => {
    if (!current) return;
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api") && !url.pathname.startsWith("/media")) return;
    const entry = { method: res.request().method(), path: url.pathname + url.search, status: res.status() };
    current.requests.push(entry);
    if (res.status() >= 400) current.failed.push(entry);
  });
  page.on("requestfailed", req => {
    if (!current) return;
    const url = new URL(req.url());
    if (!url.pathname.startsWith("/api") && !url.pathname.startsWith("/media")) return;
    current.requestFailed.push({ method: req.method(), path: url.pathname + url.search, error: req.failure()?.errorText });
  });
}

// Mantine notifications are gone after a few seconds; record every one that appears.
const NOTIFICATION_WATCH = () => {
  window.__smokeNotes = [];
  const seen = new WeakSet();
  const scan = () => {
    document.querySelectorAll(".mantine-Notification-root").forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      window.__smokeNotes.push(el.innerText.replace(/\s+/g, " ").trim());
    });
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true });
};

async function settle(page, ms = SETTLE_MS) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// SMOKE_ONLY=<regex> runs only the matching steps (plus the logins), for debugging the walk.
const only = process.env.SMOKE_ONLY ? new RegExp(process.env.SMOKE_ONLY) : null;

async function step(role, page, name, fn, kind = "action") {
  if (only && name !== "login" && !only.test(`${role} ${name}`)) return;
  current = {
    role,
    name,
    kind,
    url: null,
    consoleErrors: [],
    pageErrors: [],
    failed: [],
    requestFailed: [],
    requests: [],
    notifications: [],
    errorBoundary: false,
    stepError: null,
    tiles: null,
    ms: 0,
  };
  const started = Date.now();
  await page.evaluate(() => (window.__smokeNotes = [])).catch(() => {});
  try {
    await fn();
    await settle(page);
  } catch (err) {
    current.stepError = String(err?.message ?? err).split("\n")[0].slice(0, 300);
  }
  current.ms = Date.now() - started;
  current.url = page.url().replace(frontend, "");
  const probe = await page
    .evaluate(() => ({
      notes: window.__smokeNotes ?? [],
      body: document.body?.innerText ?? "",
      text: (document.querySelector("main") ?? document.body)?.innerText ?? "",
      tiles: document.querySelectorAll("main button.pig-btn").length,
      brokenImages: [...document.images]
        .filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith("data:"))
        .map(i => new URL(i.src).pathname)
        .slice(0, 20),
    }))
    .catch(() => ({ notes: [], body: "", text: "", tiles: 0, brokenImages: [] }));
  current.notifications = probe.notes;
  current.tiles = probe.tiles;
  current.text = probe.text.slice(0, 30_000);
  current.brokenImages = probe.brokenImages;
  current.errorBoundary = /Something went wrong/i.test(probe.body);
  const file = `${String(steps.length).padStart(3, "0")}-${role}-${name.replace(/[^a-z0-9]+/gi, "_")}.png`;
  await page.screenshot({ path: path.join(shotDir, file) }).catch(() => {});
  current.screenshot = file;
  steps.push(current);
  const bad =
    current.failed.length + current.consoleErrors.length + current.pageErrors.length + (current.stepError ? 1 : 0);
  console.log(`${bad ? "!!" : "ok"} ${role} ${name} (${current.ms} ms)${current.stepError ? ` ${current.stepError}` : ""}`);
  current = null;
}

async function newSession(browser, role) {
  const context = await browser.newContext({
    baseURL: frontend,
    locale: "en-US",
    timezoneId: "UTC",
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(NOTIFICATION_WATCH);
  const page = await context.newPage();
  trackPage(page);
  return { context, page };
}

async function login(role, page, username) {
  await step(role, page, "login", async () => {
    await page.goto("/login");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(manifest.users[username].password);
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  });
}

const visit = (role, page, name, url, extra) =>
  step(role, page, name, async () => {
    await page.goto(url);
    await settle(page, 500);
    if (extra) await extra();
  }, extra ? "action" : "visit");

// A response the step waits for after an action that may itself fail: the
// rejection must not go unhandled while the action throws first.
function responseOf(page, predicate, timeout = 20_000) {
  const pending = page.waitForResponse(predicate, { timeout });
  pending.catch(() => {});
  return pending;
}

const tiles = page => page.locator("main button.pig-btn");
// The grid restores its scroll position with timing-dependent results, so
// steps that open a photo pick it by image hash rather than "the first tile".
async function tileOf(page, key) {
  await page.mouse.move(700, 500);
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(500);
  return page.locator(`main button.pig-btn:has(img[src*="${manifest.photos[key].image_hash}"])`).first();
}
const plusButton = page => page.locator("main button:has(svg.tabler-icon-plus), header button:has(svg.tabler-icon-plus)");

const albumMenu = (page, title) =>
  page
    .locator(`main [title="${title}"]`)
    .first()
    .locator("xpath=ancestor::div[.//button][1]")
    .locator("button:has(svg.tabler-icon-dots-vertical)");

function smokeUploadFile() {
  const source = path.join(fixtureRoot, "data", "alice", "e2e", "e2e_02.jpg");
  const target = path.join(outDir, "smoke_upload.jpg");
  // Trailing bytes after the JPEG EOI marker change the hash, not the image.
  fs.writeFileSync(target, Buffer.concat([fs.readFileSync(source), Buffer.from("librephotos-smoke-upload")]));
  return target;
}

async function walkAnonymous(browser) {
  const role = "anonymous";
  const { context, page } = await newSession(browser, role);
  await visit(role, page, "protected-redirect", "/favorites");
  await visit(role, page, "login-page", "/login");
  await visit(role, page, "public-album", `/public/s/${manifest.shares.public_album.slug}`);
  await step(role, page, "public-album-lightbox", async () => {
    await tiles(page).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 10_000 });
  });
  await visit(role, page, "public-album-expired", `/public/s/${manifest.shares.expired_album.slug}`);
  await visit(role, page, "public-photo-share", `/public/p/${manifest.shares.photo_share.slug}`);
  await visit(role, page, "public-user-page", "/public/alice");
  await context.close();
}

async function walkAlice(browser) {
  const role = "alice";
  const { context, page } = await newSession(browser, role);
  await login(role, page, "alice");

  await visit(role, page, "timeline", "/");
  await step(role, page, "timeline-scroll", async () => {
    await page.mouse.move(700, 500);
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(250);
    }
  });
  for (const [name, url] of [
    ["photos", "/photos"],
    ["recent", "/recent"],
    ["favorites", "/favorites"],
    ["hidden", "/hidden"],
    ["trash", "/deleted"],
    ["videos", "/videos"],
    ["no-timestamp", "/notimestamp"],
    ["screenshots", "/screenshots"],
    ["memories", "/memories"],
  ]) {
    await visit(role, page, name, url);
  }

  await visit(role, page, "lightbox-open", "/", async () => {
    await (await tileOf(page, "alice/e2e_01")).click();
    await page.getByRole("dialog").waitFor({ timeout: 10_000 });
  });
  await step(role, page, "lightbox-sidebar", async () => {
    await page.keyboard.press("i");
  });
  for (let i = 1; i <= 6; i += 1) {
    await step(role, page, `lightbox-next-${i}`, async () => {
      await page.keyboard.press("ArrowRight");
    });
  }
  await step(role, page, "lightbox-favorite-toggle", async () => {
    const fav = page.getByRole("dialog").getByRole("button", { name: /^(Add to|Remove from) favorites/ });
    const saved = responseOf(page, r => r.url().includes("/api/photosedit/favorite") && r.request().method() === "POST");
    await fav.click();
    await saved;
    const back = responseOf(page, r => r.url().includes("/api/photosedit/favorite") && r.request().method() === "POST");
    await fav.click();
    await back;
  });
  await step(role, page, "lightbox-close", async () => {
    await page.keyboard.press("Escape");
  });
  const vacationPhoto = manifest.albums.user.vacation.photos[0];
  await visit(role, page, "photo-page-vacation", `/photo/${vacationPhoto}`);
  await step(role, page, "photo-page-sidebar", async () => {
    await page.keyboard.press("i");
  });
  const video = manifest.photos[manifest.categories.video[0]].id;
  await visit(role, page, "photo-page-video", `/photo/${video}`);

  await visit(role, page, "people", "/album/persons");
  await visit(role, page, "person-anna", `/album/persons/${manifest.persons.anna.id}`);
  await visit(role, page, "faces", "/faces");
  for (const tab of ["inferred", "unknown", "labeled"]) {
    await visit(role, page, `faces-${tab}`, `/faces?tab=${tab}`);
  }

  await visit(role, page, "albums-index", "/album");
  await visit(role, page, "albums-user", "/album/user");
  await visit(role, page, "album-user-vacation", `/album/user/${manifest.albums.user.vacation.id}`);
  await visit(role, page, "album-user-unicode", `/album/user/${manifest.albums.user.unicode.id}`);
  await visit(role, page, "albums-events", "/album/events");
  await visit(role, page, "album-event", `/album/events/${manifest.albums.auto[0].id}`);
  await visit(role, page, "albums-things", "/album/things");
  await visit(role, page, "album-thing", `/album/things/${manifest.albums.thing[0].id}`);
  await visit(role, page, "albums-places", "/album/places");
  await visit(role, page, "album-place", `/album/places/${manifest.albums.place[0].id}`);
  await visit(role, page, "albums-folders", "/album/folder");
  await step(role, page, "album-folder-open", async () => {
    await page.locator("main a[href*='/album/folder/']").first().click();
  });
  await visit(role, page, "albums-tags", "/album/tags");
  const family = manifest.tags.find(t => t.name === "family");
  await visit(role, page, "album-tag-family", `/album/tags/${family.id}`);

  await visit(role, page, "search-text", "/search/family");
  await visit(role, page, "search-place", "/search/Berlin");
  await step(role, page, "spotlight-search", async () => {
    await page.goto("/");
    await settle(page, 500);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Berlin", { delay: 50 });
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
  });

  for (const [name, url] of [
    ["sharing", "/sharing"],
    ["sharing-byme-photos", "/sharing/byme/photos"],
    ["sharing-byme-albums", "/sharing/byme/albums"],
    ["sharing-withme-photos", "/sharing/withme/photos"],
    ["sharing-withme-albums", "/sharing/withme/albums"],
    ["sharing-links", "/sharing/links"],
    ["sharing-public", "/sharing/public"],
    ["settings", "/settings"],
    ["profile", "/profile"],
    ["library", "/library"],
    ["jobs", "/jobs"],
    ["statistics", "/statistics"],
    ["statistics-timeline", "/statistics/timeline"],
    ["statistics-placetree", "/statistics/placetree"],
    ["statistics-wordclouds", "/statistics/wordclouds"],
    ["statistics-socialgraph", "/statistics/socialgraph"],
    ["statistics-faceclusters", "/statistics/faceclusters"],
    ["stacks", "/stacks"],
    ["organizing-stacks", "/organizing/stacks"],
    ["organizing-duplicates", "/organizing/duplicates"],
  ]) {
    await visit(role, page, name, url);
  }
  await visit(role, page, "job-detail-failed", `/jobs/${manifest.jobs.failed.id}`);
  await visit(role, page, "job-detail-running", `/jobs/${manifest.jobs.running.id}`);

  await visit(role, page, "upload", "/", async () => {
    const done = responseOf(page, r => /\/api\/upload\/complete/.test(r.url()), 30_000);
    await page.locator("header input[type=file]").setInputFiles(smokeUploadFile());
    await done;
  });

  await visit(role, page, "album-create", "/", async () => {
    await (await tileOf(page, "alice/e2e_01")).click({ modifiers: ["Shift"] });
    await plusButton(page).first().click();
    await page.getByRole("menuitem", { name: "Album" }).click();
    await page.getByPlaceholder("Album title").fill("Smoke Album");
    const created = responseOf(page, r => /\/api\/albums\/user\/edit/.test(r.url()) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Create" }).click();
    await created;
  });
  await visit(role, page, "album-rename", "/album/user", async () => {
    await albumMenu(page, "Smoke Album").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog").locator("input").fill("Smoke Album Renamed");
    const renamed = responseOf(page, r => /\/api\/albums\/user/.test(r.url()) && r.request().method() === "PATCH");
    await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
    await renamed;
  });
  await visit(role, page, "album-delete", "/album/user", async () => {
    await albumMenu(page, "Smoke Album Renamed").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleted = responseOf(page, r => /\/api\/albums\/user/.test(r.url()) && r.request().method() === "DELETE");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await deleted;
  });

  await visit(role, page, "face-label", "/faces?tab=inferred", async () => {
    await page.locator("main .mantine-Avatar-root").first().click();
    await plusButton(page).first().click();
    await page.getByPlaceholder("Person Name").fill("Smoke Person");
    const labelled = responseOf(page, r => /\/api\/labelfaces/.test(r.url()) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Add Person" }).click();
    await labelled;
  });
  await visit(role, page, "people-after-label", "/album/persons");

  await context.close();
}

async function walkOthers(browser) {
  for (const username of ["bob", "carol"]) {
    const { context, page } = await newSession(browser, username);
    await login(username, page, username);
    await visit(username, page, "sharing-withme-photos", "/sharing/withme/photos");
    await visit(username, page, "sharing-withme-albums", "/sharing/withme/albums");
    await step(username, page, "sharing-withme-album-open", async () => {
      await page.locator("main a[href*='/album/user/']").first().click();
    });
    await context.close();
  }
}

async function walkAdmin(browser) {
  const role = "admin";
  const { context, page } = await newSession(browser, role);
  await login(role, page, "admin");
  for (const [name, url] of [
    ["timeline", "/"],
    ["admin", "/admin"],
    ["jobs", "/jobs"],
    ["settings", "/settings"],
    ["library", "/library"],
    ["profile", "/profile"],
    ["statistics", "/statistics"],
  ]) {
    await visit(role, page, name, url);
  }
  await visit(role, page, "admin-job-detail", `/admin/job/${manifest.jobs.finished.id}`);
  await context.close();
}

const probe = await fetch(frontend).catch(() => null);
if (!probe?.ok) {
  console.error(`frontend ${frontend} is not reachable`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: process.env.SMOKE_HEADED !== "1" });
try {
  await walkAnonymous(browser);
  await walkAlice(browser);
  await walkOthers(browser);
  await walkAdmin(browser);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ label, frontend, steps }, null, 2));
  console.log(`report: ${path.join(outDir, "report.json")}`);
}
