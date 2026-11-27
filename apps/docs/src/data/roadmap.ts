export type Track = "feature" | "install";

export type Status = "planned" | "in-progress" | "beta";

type Base = {
  id: string;
  track: Track;
  title: string;
  body: string;
  link: string;
};

export type VersionedItem = Base & { version: string };

export type WeeklyItem = Base & { weekly: string; date: string };

export type PlannedItem = Base & { status: Status; issue?: number; pr?: number };

export type RoadmapItem = VersionedItem | WeeklyItem | PlannedItem;

export type ReleaseInfo = { date: string; permalink: string };

export type ReleaseLookup = (version: string) => ReleaseInfo | null;

export type ShippedRelease = {
  version: string;
  date: string;
  permalink: string;
  items: (VersionedItem | WeeklyItem)[];
};

export type RoadmapPlan = {
  shipped: ShippedRelease[];
  next: VersionedItem[];
  planned: PlannedItem[];
};

export const STATUS_ORDER: readonly Status[] = ["in-progress", "beta", "planned"];

export const ROADMAP: readonly RoadmapItem[] = [
  {
    id: "viewer-microsoft-store",
    track: "install",
    status: "in-progress",
    title: "LibrePhotos Viewer in the Microsoft Store",
    body: "The desktop app, installed and updated by Windows. The package is built and waits for its listing.",
    link: "/docs/user-guide/desktop#the-microsoft-store-build",
  },
  {
    id: "viewer-mac-app-store",
    track: "install",
    status: "in-progress",
    title: "LibrePhotos Viewer in the Mac App Store",
    body: "The same app in Apple's sandbox. CI builds the App Store package on every run; the listing comes next.",
    link: "/docs/user-guide/desktop#the-mac-app-store-build",
  },
  {
    id: "server-mac-app",
    track: "install",
    status: "in-progress",
    title: "LibrePhotos server as a Mac app",
    body: "Run the whole server on a Mac without Docker, with the built-in updater the Windows app has.",
    link: "https://github.com/LibrePhotos/librephotos/pull/3120",
    pr: 3120,
  },
  {
    id: "hybrid-search",
    track: "feature",
    status: "in-progress",
    title: "Hybrid search",
    body: "Words and meaning searched together, best match first, with dates, people and places as filters.",
    link: "https://github.com/LibrePhotos/librephotos/pull/3128",
    pr: 3128,
  },
  {
    id: "uhuruphotos",
    track: "install",
    status: "beta",
    title: "UhuruPhotos for Android",
    body: "A third-party Android app for LibrePhotos with camera-roll backup, in beta on Google Play.",
    link: "/docs/user-guide/mobile#uhuruphotos",
  },
  {
    id: "preview-apk",
    track: "install",
    status: "planned",
    title: "A preview APK of the new mobile app",
    body: "A signed Android build of the official app attached to every release, so you can try it without building it.",
    link: "https://github.com/LibrePhotos/librephotos/issues/2910",
    issue: 2910,
  },
  {
    id: "mobile-stores",
    track: "install",
    status: "planned",
    title: "The mobile app on Google Play and the App Store",
    body: "The official app with automatic phone backup, for Android and iPhone.",
    link: "https://github.com/LibrePhotos/librephotos/issues/3019",
    issue: 3019,
  },
  {
    id: "viewer-linux",
    track: "install",
    status: "planned",
    title: "LibrePhotos Viewer for Linux",
    body: "The desktop app runs on Windows and macOS. Linux builds come next.",
    link: "https://github.com/LibrePhotos/librephotos/issues/3020",
    issue: 3020,
  },
  {
    id: "scheduled-backups",
    track: "feature",
    status: "planned",
    title: "Scheduled database backups",
    body: "LibrePhotos copies its database on a schedule you set, not only before an update.",
    link: "https://github.com/LibrePhotos/librephotos/issues/3055",
    issue: 3055,
  },
  {
    id: "password-share-links",
    track: "feature",
    status: "planned",
    title: "Password-protected share links",
    body: "A public link that asks for a password before it shows the album or photo.",
    link: "https://github.com/LibrePhotos/librephotos/issues/3013",
    issue: 3013,
  },
  {
    id: "photo-editor",
    track: "feature",
    version: "1.7.0",
    title: "Photo editor with RAW",
    body: "Crop, straighten, filters and adjustments that never change the original, RAW files included.",
    link: "/docs/user-guide/editing-photos",
  },
  {
    id: "desktop-viewer",
    track: "install",
    version: "1.7.0",
    title: "LibrePhotos Viewer for Windows and Mac",
    body: "A desktop photo viewer that works on its own and with your server: an installer for Windows, a disk image for Mac.",
    link: "/docs/user-guide/desktop#installing-it",
  },
  {
    id: "windows-installer",
    track: "install",
    version: "1.7.0",
    title: "An installer for the Windows server",
    body: "LibrePhotos-Setup.exe installs the server for your user account, without administrator rights.",
    link: "/docs/installation/windows-standalone#installing",
  },
  {
    id: "expiring-links-qr",
    track: "feature",
    version: "1.7.0",
    title: "Expiring photo links and QR codes",
    body: "Photo links can expire like album links, and every public link has a QR code.",
    link: "/docs/user-guide/sharing#qr-codes",
  },
  {
    id: "camera-statistics",
    track: "feature",
    version: "1.7.0",
    title: "Cameras, lenses and a photos-per-day heatmap",
    body: "New statistics on what you shoot with and when.",
    link: "/docs/user-guide/statistics#cameras",
  },
  {
    id: "fresh-look",
    track: "feature",
    version: "1.6.0",
    title: "A fresh look",
    body: "A calmer design on every page, also on phones, and big days that load fast without jumping.",
    link: "/docs/user-guide/viewing-photos#timeline-home",
  },
  {
    id: "rewind",
    track: "feature",
    version: "1.6.0",
    title: "Your year in photos",
    body: "Rewind shows your busiest day and the people and places you photographed most.",
    link: "/docs/user-guide/settings#site-settings",
  },
  {
    id: "error-reports",
    track: "feature",
    version: "1.6.0",
    title: "Error reports that stay on your server",
    body: "Nothing is sent until you choose to share a report.",
    link: "/docs/user-guide/error-reporting#the-choices",
  },
  {
    id: "share-library",
    track: "feature",
    version: "1.5.0",
    title: "Share your whole library",
    body: "Share everything, one person or one album with another user.",
    link: "/docs/user-guide/sharing#sharing-your-whole-library",
  },
  {
    id: "photos-on-the-map",
    track: "feature",
    version: "1.5.0",
    title: "Photos on the map",
    body: "The Places page shows your photos on a map, with places of your own.",
    link: "/docs/user-guide/places#the-places-page",
  },
  {
    id: "scrubber-styles",
    track: "feature",
    version: "1.5.0",
    title: "Scroll scrubber styles",
    body: "The timeline's scroll bar reaches the header and comes in thumb and density styles.",
    link: "/docs/user-guide/viewing-photos#scroll-bar-style",
  },
  {
    id: "windows-updates",
    track: "install",
    version: "1.5.0",
    title: "Updates from the Windows app",
    body: "The Windows app downloads a new release and restarts into it.",
    link: "/docs/installation/windows-standalone#update-from-the-app",
  },
  {
    id: "any-gpu",
    track: "install",
    version: "1.5.0",
    title: "Any GPU, one image",
    body: "Intel, AMD and NVIDIA GPUs run the models in the regular Docker image and the single container.",
    link: "/docs/installation/environment-variables#utilizing-gpu-acceleration",
  },
  {
    id: "write-edits-to-files",
    track: "feature",
    version: "1.4.0",
    title: "Your edits, in your files",
    body: "Tags, captions, locations and rotations are written back to the photo or its sidecar.",
    link: "/docs/user-guide/exif-data#writing-the-edits-of-a-whole-library",
  },
  {
    id: "search-filters",
    track: "feature",
    version: "1.4.0",
    title: "Search filters",
    body: "Narrow a search down by people, camera, exposure, rating, day, location and file.",
    link: "/docs/user-guide/search#search-filters",
  },
  {
    id: "google-takeout",
    track: "feature",
    version: "1.4.0",
    title: "Google Takeout imports",
    body: "Dates, locations and descriptions from a Google Photos export are read during the scan.",
    link: "/docs/user-guide/google-takeout",
  },
  {
    id: "openclip",
    track: "feature",
    version: "1.3.0",
    title: "One open model for tags and search",
    body: "OpenCLIP finds things on your photos and powers semantic search in a single pass.",
    link: "/docs/user-guide/search#semantic-search",
  },
  {
    id: "timeline-filter",
    track: "feature",
    version: "1.3.0",
    title: "Timeline filter",
    body: "Show only photos or only videos, and leave screenshots and documents out of the timeline.",
    link: "/docs/user-guide/viewing-photos#filtering-the-timeline",
  },
  {
    id: "videos-everywhere",
    track: "feature",
    version: "1.3.0",
    title: "Videos that play in every browser",
    body: "A video your browser cannot play is converted as it plays.",
    link: "/docs/user-guide/viewing-photos#videos-your-browser-cannot-play",
  },
  {
    id: "windows-app",
    track: "install",
    version: "1.2.0",
    title: "A Windows app",
    body: "Unzip one download and the whole server runs on Windows, no Docker needed.",
    link: "/docs/installation/windows-standalone",
  },
  {
    id: "memories",
    track: "feature",
    version: "1.2.0",
    title: "Memories",
    body: "The photos you took around this date in earlier years, played back as a slideshow.",
    link: "/docs/user-guide/memories",
  },
  {
    id: "captions",
    track: "feature",
    version: "1.2.0",
    title: "Captions that name people and places",
    body: "A small vision-language model writes captions with who is in the photo and where it was taken.",
    link: "/docs/user-guide/image-captioning",
  },
  {
    id: "single-sign-on",
    track: "feature",
    version: "1.1.0",
    title: "Single sign-on",
    body: "Log in with Keycloak, Authentik, Authelia or any other OpenID Connect provider.",
    link: "/docs/user-guide/settings/single-sign-on",
  },
  {
    id: "ocr",
    track: "feature",
    version: "1.1.0",
    title: "Text search in your photos",
    body: "Screenshots and documents get their own category, and the text on them is searchable.",
    link: "/docs/user-guide/text-recognition",
  },
  {
    id: "version-numbers",
    track: "install",
    version: "1.0.0",
    title: "Numbered releases",
    body: "Releases are numbered instead of named after the week, so updates are easier to follow.",
    link: "/blog/1-0-0",
  },
  {
    id: "insightface",
    track: "feature",
    weekly: "2026w25",
    date: "2026-06-21",
    title: "A new face recognition engine",
    body: "InsightFace with ArcFace embeddings matches faces more accurately.",
    link: "/docs/user-guide/face-recognition",
  },
  {
    id: "face-tag-writeback",
    track: "feature",
    weekly: "2026w14",
    date: "2026-04-05",
    title: "Face tags written to sidecars",
    body: "Named faces are written as standard XMP face regions that other photo apps read.",
    link: "/docs/user-guide/exif-data#face-regions",
  },
  {
    id: "stacks",
    track: "feature",
    weekly: "2026w09",
    date: "2026-03-01",
    title: "Stacks, file variants and duplicates",
    body: "RAW and JPEG pairs and Live Photos become one photo, and duplicates are found for you.",
    link: "/docs/user-guide/stacks-and-file-variants",
  },
  {
    id: "unified-image",
    track: "install",
    weekly: "2025w35",
    date: "2025-08-28",
    title: "A single container",
    body: "One Docker image with everything inside, database included.",
    link: "/docs/installation/unified-deployment",
  },
  {
    id: "public-album-links",
    track: "feature",
    weekly: "2025w35",
    date: "2025-08-28",
    title: "Public album links",
    body: "Share an album with anyone through a link.",
    link: "/docs/user-guide/sharing#public-album-sharing-via-link",
  },
  {
    id: "gpu-image",
    track: "install",
    weekly: "2023w37",
    date: "2023-09-15",
    title: "A Docker image with GPU support",
    body: "Machine learning on NVIDIA GPUs, until 1.5.0 brought every GPU into the regular image.",
    link: "/blog/2023w37",
  },
  {
    id: "motion-photos",
    track: "feature",
    weekly: "2023w18",
    date: "2023-05-01",
    title: "Motion Photos",
    body: "LibrePhotos supports the Motion Photos of Samsung and Google phones.",
    link: "/blog/2023w18",
  },
  {
    id: "scrollbar-dates",
    track: "feature",
    weekly: "2022w45",
    date: "2022-11-16",
    title: "Dates on the scroll bar",
    body: "Scrolling the timeline shows which date you are at.",
    link: "/blog/2022w45",
  },
];

export function isPlanned(item: RoadmapItem): item is PlannedItem {
  return "status" in item;
}

export function isWeekly(item: RoadmapItem): item is WeeklyItem {
  return "weekly" in item;
}

export function planRoadmap(items: readonly RoadmapItem[], lookup: ReleaseLookup): RoadmapPlan {
  const releases = new Map<string, ShippedRelease>();
  const next: VersionedItem[] = [];
  const planned: PlannedItem[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Roadmap item "${item.id}" is listed twice in src/data/roadmap.ts`);
    }
    ids.add(item.id);
    if (isPlanned(item)) {
      planned.push(item);
      continue;
    }
    let shipped: Omit<ShippedRelease, "items"> | null;
    if (isWeekly(item)) {
      shipped = { version: item.weekly, date: item.date, permalink: `/blog/${item.weekly}` };
    } else {
      shipped = releaseOf(item, lookup);
      if (!shipped) {
        next.push(item);
        continue;
      }
    }
    const release = releases.get(shipped.version) ?? { ...shipped, items: [] };
    release.items.push(item);
    releases.set(shipped.version, release);
  }
  planned.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const shipped = [...releases.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { shipped, next, planned };
}

function releaseOf(item: VersionedItem, lookup: ReleaseLookup): Omit<ShippedRelease, "items"> | null {
  const info = lookup(item.version);
  return info ? { version: item.version, date: info.date.slice(0, 10), permalink: info.permalink } : null;
}
