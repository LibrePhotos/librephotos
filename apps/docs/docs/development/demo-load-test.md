---
title: "Demo load test"
description: "How many people can browse the view-only demo at once, and what limits it."
---

<Since version="1.7.0" />

How many people can look around the [public demo](../installation/demo-site.md) at the same time, measured on 2026-11-27 with `tools/demo-load-test/load-test.ts`.

## Short answer

On a Hetzner CAX11 (2 Arm cores, 4 GB), about **10 to 15 people clicking around at the same moment** keep 95 % of requests under one second. Around 20 the 95th percentile reaches one second; at 25 it is 1.3 s. Nothing fails: up to 200 simultaneous visitors every request is answered, only more slowly (p95 15 s at 200).

Sustained, the server serves about 150 requests a second. A first visit is about 350 requests (the web app's 247 script and style files, about 60 API calls and about 60 images), so that is roughly **25 new visitors a minute, 1,500 an hour**, as long as they do not all arrive in the same second. Real visitors spend most of their time looking at a photo, so many more people can have the demo open at once than are clicking at the same moment.

The limit is the server's CPU: both cores are busy from about 20 visitors on, while the network carries only 12 Mbit/s and the container uses at most 650 MiB.

## What a visitor does

Each virtual visitor repeats one visit, as a new visitor with an empty browser cache:

1. Opens the app: `index.html` and the 247 script and style files a real first visit loads (Chromium loaded 247 on the demo), over 6 connections like a browser.
2. Signs in to the demo account.
3. Loads what the web app loads at start (site settings, stats, albums, people, memories and so on, 19 calls), the list of days and every day's photos, then every thumbnail on screen.
4. Looks for 3 to 6 seconds, then opens three photos one after another (details and the large thumbnail), 2 to 5 seconds each.
5. Opens People (the list and 12 face crops), a place and an event (the list, the album and its thumbnails), with 1.5 to 4 seconds between them.

The run raises the number of visitors in steps of 60 seconds (5, 10, 25, 50, 100, 200), reports the latency, errors, requests and megabits per second of each step and samples the container's CPU and memory with `docker stats` over SSH every 3 seconds. A step with more visitors does not finish more visits in its minute: a first visit alone is 350 requests.

## Results

The demo as deployed: `DEMO_SITE=true`, `WEB_CONCURRENCY=2`, `WEB_MAX_REQUESTS=100000`, `NUM_PROXIES=1`, `AUTH_THROTTLE_RATE=120/minute`, the `image_similarity` service, SQLite, 38 photos, behind Coolify's Traefik on plain HTTP. CPU is the container's, so 200 % is both cores.

| Visitors | Requests/s | p50 | p95 | Errors | Mbit/s | CPU | Memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 56 | 79 ms | 358 ms | 0 % | 5.4 | 188 % | 363 MiB |
| 10 | 111 | 116 ms | 434 ms | 0 % | 10.2 | 177 % | 482 MiB |
| 15 | 86 | 272 ms | 1.24 s | 0 % | 8.1 | 193 % | 466 MiB |
| 20 | 132 | 362 ms | 957 ms | 0 % | 12.0 | 186 % | 522 MiB |
| 25 | 138 | 520 ms | 1.31 s | 0 % | 12.4 | 189 % | 485 MiB |
| 50 | 145 | 1.16 s | 2.91 s | 0 % | 11.9 | 189 % | 581 MiB |
| 100 | 158 | 2.27 s | 6.56 s | 0 % | 12.8 | 193 % | 652 MiB |
| 200 | 162 | 4.14 s | 15.6 s | 0 % | 13.1 | 193 % | 616 MiB |

15 and 20 come from a second, shorter run. At 15 the start of the step, when every visitor loads the 247 files at once, weighs more than at 20; read the two together as "the knee is between 10 and 25".

With one web server process (`WEB_CONCURRENCY=1`, the first run) the box served about the same number of requests, but the latency grew sooner: p95 638 ms at 10 visitors, 1.43 s at 25, 8.7 s at 200, with one core at 120 % to 135 % and at most 313 MiB. One process idles at 156 MiB instead of about 330 MiB.

A returning visitor, whose browser keeps the 247 files, is not cheaper for the server: the files are the cheapest requests, and without them each visitor gets to the API calls and thumbnails sooner. 25 returning visitors: p95 2.1 s; 50: p95 2.9 s.

## Where the limit is

- **Server CPU.** Both cores are busy from about 20 visitors on, in the two web server processes (Django serves the API, every thumbnail and, through WhiteNoise, the web app's files) and Traefik (about 15 % of a core). More visitors only make the queue longer.
- **Not this PC's connection.** The load ran from a home connection that downloads about 31 Mbit/s (Hetzner's speed test file from the same data centre). The test used at most 13 Mbit/s of it.
- **Not memory.** At most 652 MiB of the 1.5 GB limit.

Settings that mattered:

- `WEB_MAX_REQUESTS`: the single-container image restarts a web server process after 2,000 requests when there is more than one. At 150 requests a second each process restarted every 13 seconds, and starting Django again ate the second core: two processes were no faster than one and answered a few requests with 502. `100000` keeps them running.
- `NUM_PROXIES=1`: behind Traefik every visitor arrives from Traefik's address. With the image's default `0` all visitors share one sign-in budget (`AUTH_THROTTLE_RATE`, 10 a minute per address and account), and everyone signs in to the same account. The first run hit it: 0.2 % to 0.4 % of requests were `429`.
- The `image_similarity` service: without it every photo the visitor opens waits about a second for the Similar photos call to give up.

To serve more visitors, put a cache in front of `/assets/` (a CDN, or a proxy that caches), which takes 247 of the 350 requests of a first visit away from Django, or use a server with more cores.

## Running it

```bash
bun run tools/demo-load-test/load-test.ts \
  --base https://demo.example.com \
  --steps 5,10,25,50,100,200 --step-seconds 60 \
  --stats-host my-server --stats-container my-demo-container \
  --out results.json
```

`--username` and `--password` default to `demo` and `demo1234`. `--returning` keeps the web app's files after a visitor's first visit, like a browser cache. `--stats-host` is an SSH host that may run `docker stats`; leave it out to skip the server numbers. Keep a run under 10 minutes, and run it from a machine whose connection is faster than the megabits per second it reports, or the connection becomes the limit. Every visitor signs in from the same address, so the demo's `AUTH_THROTTLE_RATE` must allow the visits a minute the run makes.
