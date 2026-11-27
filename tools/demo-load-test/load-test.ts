#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

type Options = {
  base: string;
  assetLimit: number;
  returning: boolean;
  username: string;
  password: string;
  steps: number[];
  stepSeconds: number;
  statsHost: string | null;
  statsContainer: string | null;
  out: string | null;
};

type Sample = { name: string; status: number; ms: number; bytes: number; at: number; step: number };

type ServerStat = { at: number; step: number; cpu: number; memMiB: number };

type DayItem = { image_hash: string; type: string; video_poster?: boolean };

type AlbumDetail = {
  photos?: DayItem[];
  results?: { grouped_photos?: { items?: DayItem[] }[] };
};

function albumItems(detail: AlbumDetail | null): DayItem[] {
  if (Array.isArray(detail?.photos)) return detail.photos;
  return (detail?.results?.grouped_photos ?? []).flatMap(group => (Array.isArray(group.items) ? group.items : []));
}

type StepReport = {
  viewers: number;
  requests: number;
  rps: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  apiP95: number;
  mediaP95: number;
  mbitPerSecond: number;
  visitsStarted: number;
  visitsCompleted: number;
  errorsByStatus: Record<string, number>;
  serverCpuMax: number | null;
  serverMemMaxMiB: number | null;
  p95ByRequest: Record<string, number>;
};

const BROWSER_CONNECTIONS = 6;
const THUMBNAILS_PER_SCREEN = 60;
const DAY_QUERY = "archived=false&libraries=true";
const BOOT_CALLS = [
  "/api/firsttimesetup/",
  "/api/sitesettings",
  "/api/auth/sso/config/",
  "/api/stats/",
  "/api/searchtermexamples/",
  "/api/albums/place/list/",
  "/api/albums/thing/list/",
  "/api/albums/user/list/",
  "/api/persons/?page_size=1000",
  "/api/rqavailable/",
  "/api/imagetag/",
  "/api/storagestats/",
  "/api/duplicates/stats",
  "/api/albums/user/shared/tome/",
  "/api/library-shares/",
  "/api/user/",
  "/api/memories",
  "/api/tags/",
  "/api/upload/status/",
];

function parseOptions(argv: string[]): Options {
  const value = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] !== undefined ? String(argv[index + 1]) : fallback;
  };
  const base = value("--base", "").replace(/\/+$/, "");
  if (!base) throw new Error("--base https://demo.example.com is required");
  return {
    base,
    assetLimit: Number(value("--asset-limit", "250")),
    returning: argv.includes("--returning"),
    username: value("--username", "demo"),
    password: value("--password", "demo1234"),
    steps: value("--steps", "5,10,25,50,100,200")
      .split(",")
      .map(step => Number(step.trim()))
      .filter(step => step > 0),
    stepSeconds: Number(value("--step-seconds", "60")),
    statsHost: value("--stats-host", "") || null,
    statsContainer: value("--stats-container", "") || null,
    out: value("--out", "") || null,
  };
}

const options = parseOptions(Bun.argv.slice(2));
const samples: Sample[] = [];
const serverStats: ServerStat[] = [];
let currentStep = 0;
let stepEndsAt = 0;
const visitsStarted = new Map<number, number>();
const visitsCompleted = new Map<number, number>();
const count = (counter: Map<number, number>) => counter.set(currentStep, (counter.get(currentStep) ?? 0) + 1);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const think = (minMs: number, maxMs: number) => sleep(minMs + Math.random() * (maxMs - minMs));
const stepOver = () => Date.now() >= stepEndsAt;

async function request(name: string, path: string, init: RequestInit = {}): Promise<Response | null> {
  const started = performance.now();
  const step = currentStep;
  try {
    const response = await fetch(`${options.base}${path}`, {
      ...init,
      headers: { "Accept-Encoding": "gzip, br", ...init.headers },
    });
    const body = await response.arrayBuffer();
    const wireBytes = Number(response.headers.get("content-length") ?? body.byteLength);
    samples.push({
      name,
      status: response.status,
      ms: performance.now() - started,
      bytes: Number.isFinite(wireBytes) ? wireBytes : body.byteLength,
      at: Date.now(),
      step,
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch {
    samples.push({ name, status: 0, ms: performance.now() - started, bytes: 0, at: Date.now(), step });
    return null;
  }
}

async function json<T>(name: string, path: string, token: string): Promise<T | null> {
  const response = await request(name, path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response || !response.ok) return null;
  return (await response.json()) as T;
}

async function inParallel<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
  });
  await Promise.all(workers);
}

const assetGraph = new Map<string, string[]>();

async function assetReferences(path: string): Promise<string[]> {
  const known = assetGraph.get(path);
  if (known) return known;
  const response = await fetch(`${options.base}${path}`);
  const text = path.endsWith(".js") ? await response.text() : "";
  const references = [...new Set([...text.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)].map(match => `/${match[0]}`))];
  assetGraph.set(path, references);
  return references;
}

async function appAssets(html: string): Promise<string[]> {
  const entries = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map(match => String(match[1]));
  const ordered: string[] = [];
  const queue = [...entries];
  const seen = new Set(queue);
  while (queue.length > 0 && ordered.length < options.assetLimit) {
    const path = queue.shift();
    if (!path) break;
    ordered.push(path);
    for (const reference of await assetReferences(path)) {
      if (!seen.has(reference)) {
        seen.add(reference);
        queue.push(reference);
      }
    }
  }
  return ordered;
}

let cachedAssets: string[] | null = null;

class Viewer {
  private readonly seen = new Set<string>();
  private token = "";

  constructor(private readonly assetsCached: boolean) {}

  private media(name: string, path: string): Promise<void> {
    if (this.seen.has(path)) return Promise.resolve();
    this.seen.add(path);
    return request(name, path, { headers: { Authorization: `Bearer ${this.token}` } }).then(() => undefined);
  }

  private async openApp(): Promise<void> {
    const response = await request("app.html", "/");
    if (!response?.ok) return;
    cachedAssets ??= await appAssets(await response.text());
    if (this.assetsCached) return;
    await inParallel(cachedAssets, BROWSER_CONNECTIONS, asset => request("app.asset", asset).then(() => undefined));
  }

  private async signIn(): Promise<boolean> {
    const response = await request("auth.obtain", "/api/auth/token/obtain/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: options.username, password: options.password }),
    });
    if (!response?.ok) return false;
    const body = (await response.json()) as { access?: string };
    this.token = body.access ?? "";
    return this.token !== "";
  }

  private async thumbnails(items: DayItem[]): Promise<void> {
    const paths = items
      .slice(0, THUMBNAILS_PER_SCREEN)
      .map(item =>
        item.type === "video" && item.video_poster
          ? `/media/square_thumbnails/${item.image_hash}.webp`
          : `/media/square_thumbnails/${item.image_hash}`
      );
    await inParallel(paths, BROWSER_CONNECTIONS, path => this.media("media.square", path));
  }

  private async timeline(): Promise<DayItem[]> {
    await inParallel(BOOT_CALLS, BROWSER_CONNECTIONS, path => json("api.boot", path, this.token).then(() => undefined));
    const days = await json<{ results: { id: number }[] }>("api.days", `/api/days/?${DAY_QUERY}`, this.token);
    const pages: { items: DayItem[] }[] = [];
    await inParallel(days?.results ?? [], BROWSER_CONNECTIONS, async day => {
      const page = await json<{ items: DayItem[] }>(
        "api.day.photos",
        `/api/days/${day.id}/photos/?${DAY_QUERY}&limit=100`,
        this.token
      );
      if (page) pages.push(page);
    });
    const items = pages.flatMap(page => page.items);
    await this.thumbnails(items);
    await think(3000, 6000);
    return items;
  }

  private async lightbox(items: DayItem[]): Promise<void> {
    const photos = items.filter(item => item.type !== "video");
    for (let opened = 0; opened < 3 && photos.length > 0 && !stepOver(); opened++) {
      const photo = photos[Math.floor(Math.random() * photos.length)];
      if (!photo) break;
      await Promise.all([
        json("api.photo", `/api/photos/${photo.image_hash}/`, this.token),
        this.media("media.big", `/media/thumbnails_big/${photo.image_hash}`),
      ]);
      await think(2000, 5000);
    }
  }

  private async album(
    listName: string,
    listPath: string,
    detailName: string,
    detailPath: (id: number | string) => string
  ): Promise<void> {
    const list = await json<{ results: { id: number | string }[] }>(listName, listPath, this.token);
    const first = list?.results[0];
    if (!first) return;
    const detail = await json<AlbumDetail>(detailName, detailPath(first.id), this.token);
    await this.thumbnails(albumItems(detail));
  }

  private async people(): Promise<void> {
    const persons = await json<{ results: { face_url?: string | null }[] }>(
      "api.persons",
      "/api/persons/?page_size=50",
      this.token
    );
    const faces = (persons?.results ?? []).flatMap(person => (person.face_url ? [person.face_url] : [])).slice(0, 12);
    await inParallel(faces, BROWSER_CONNECTIONS, face => this.media("media.face", face));
  }

  async session(): Promise<void> {
    count(visitsStarted);
    await this.openApp();
    if (!(await this.signIn())) {
      await think(1000, 2000);
      return;
    }
    const items = await this.timeline();
    if (stepOver()) return;
    await this.lightbox(items);
    if (stepOver()) return;
    await this.people();
    await think(1500, 3000);
    if (stepOver()) return;
    await this.album("api.places", "/api/albums/place/list/", "api.place", id => `/api/albums/place/${id}/`);
    await think(1500, 3000);
    if (stepOver()) return;
    await this.album("api.events", "/api/albums/auto/list/", "api.event", id => `/api/albums/auto/${id}/`);
    count(visitsCompleted);
    await think(2000, 4000);
  }
}

async function viewerLoop(): Promise<void> {
  for (let visit = 0; !stepOver(); visit++) await new Viewer(options.returning && visit > 0).session();
}

function parsePercent(text: string): number {
  return Number(text.replace("%", "").trim()) || 0;
}

function parseMiB(text: string): number {
  const match = /([\d.]+)\s*([KMG]i?B)/.exec(text);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = String(match[2]);
  if (unit.startsWith("G")) return amount * 1024;
  if (unit.startsWith("K")) return amount / 1024;
  return amount;
}

function sampleServer(host: string, container: string): () => void {
  let running = true;
  const loop = async () => {
    while (running) {
      const step = currentStep;
      const output = await new Promise<string>(resolve => {
        const child = spawn("ssh", [
          host,
          "docker",
          "stats",
          "--no-stream",
          "--format",
          "'{{.CPUPerc}}	{{.MemUsage}}'",
          container,
        ]);
        let text = "";
        child.stdout.on("data", chunk => (text += String(chunk)));
        child.on("close", () => resolve(text));
      });
      const [cpu, mem] = output.trim().split(/\s+\|\s+|\t/);
      if (cpu && mem) serverStats.push({ at: Date.now(), step, cpu: parsePercent(cpu), memMiB: parseMiB(mem) });
      await sleep(3000);
    }
  };
  void loop();
  return () => {
    running = false;
  };
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

function report(viewers: number, step: number, seconds: number): StepReport {
  const stepSamples = samples.filter(sample => sample.step === step);
  const latencies = stepSamples.map(sample => sample.ms).sort((a, b) => a - b);
  const api = stepSamples.filter(sample => sample.name.startsWith("api.") || sample.name.startsWith("auth."));
  const media = stepSamples.filter(sample => sample.name.startsWith("media."));
  const errors = stepSamples.filter(sample => sample.status === 0 || sample.status >= 400).length;
  const bytes = stepSamples.reduce((sum, sample) => sum + sample.bytes, 0);
  const stats = serverStats.filter(stat => stat.step === step);
  return {
    viewers,
    requests: stepSamples.length,
    rps: Math.round((stepSamples.length / seconds) * 10) / 10,
    errors,
    errorRate: stepSamples.length ? Math.round((errors / stepSamples.length) * 10000) / 100 : 0,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    apiP95: percentile(
      api.map(sample => sample.ms).sort((a, b) => a - b),
      0.95
    ),
    mediaP95: percentile(
      media.map(sample => sample.ms).sort((a, b) => a - b),
      0.95
    ),
    mbitPerSecond: Math.round(((bytes * 8) / seconds / 1e6) * 10) / 10,
    visitsStarted: visitsStarted.get(step) ?? 0,
    visitsCompleted: visitsCompleted.get(step) ?? 0,
    errorsByStatus: stepSamples
      .filter(sample => sample.status === 0 || sample.status >= 400)
      .reduce<Record<string, number>>((byStatus, sample) => {
        byStatus[String(sample.status)] = (byStatus[String(sample.status)] ?? 0) + 1;
        return byStatus;
      }, {}),
    serverCpuMax: stats.length ? Math.max(...stats.map(stat => stat.cpu)) : null,
    serverMemMaxMiB: stats.length ? Math.round(Math.max(...stats.map(stat => stat.memMiB))) : null,
    p95ByRequest: Object.fromEntries(
      [...new Set(stepSamples.map(sample => sample.name))].map(name => [
        name,
        percentile(
          stepSamples
            .filter(sample => sample.name === name)
            .map(sample => sample.ms)
            .sort((a, b) => a - b),
          0.95
        ),
      ])
    ),
  };
}

async function main(): Promise<void> {
  const stopSampling =
    options.statsHost && options.statsContainer ? sampleServer(options.statsHost, options.statsContainer) : () => {};
  const reports: StepReport[] = [];
  for (const [index, viewers] of options.steps.entries()) {
    currentStep = index;
    stepEndsAt = Date.now() + options.stepSeconds * 1000;
    const started = Date.now();
    await Promise.all(
      Array.from({ length: viewers }, async (_, n) => {
        await sleep((n / viewers) * Math.min(10_000, options.stepSeconds * 250));
        await viewerLoop();
      })
    );
    const row = report(viewers, index, (Date.now() - started) / 1000);
    reports.push(row);
    console.log(JSON.stringify(row));
  }
  stopSampling();
  if (options.out) writeFileSync(options.out, JSON.stringify({ options: { ...options, password: "***" }, reports }, null, 2));
  console.table(reports.map(({ p95ByRequest, errorsByStatus, ...row }) => row));
}

await main();
