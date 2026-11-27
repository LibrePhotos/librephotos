import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import Since from "@site/src/components/Since";
import releases from "@site/src/data/releases.json";
import { sinceState, type SinceIndex } from "@site/src/data/releases";
import home from "./index.module.css";
import styles from "./viewer.module.css";

const DESCRIPTION =
  "LibrePhotos Viewer is a free, open source picture viewer and library for Windows and macOS. Camera RAW with its own decoder, HEIC and AVIF, XMP sidecars that digiKam and darktable read, a timeline of your own folders and search. No account, no import, no cloud.";

const DESKTOP_SINCE = "1.7.0";
const RELEASE_INDEX: SinceIndex = releases;
const DESKTOP_RELEASED = sinceState(DESKTOP_SINCE, RELEASE_INDEX).released;

const STORE_URL = "https://apps.microsoft.com/detail/9PPB50KW4X52";
const RELEASE_DOWNLOAD = "https://github.com/LibrePhotos/librephotos/releases/latest/download";
const WINDOWS_SETUP_URL = `${RELEASE_DOWNLOAD}/librephotos-desktop-windows-x64-setup.exe`;
const MAC_DMG_URL = `${RELEASE_DOWNLOAD}/librephotos-desktop-macos-universal.dmg`;
const SOURCE_URL = "https://github.com/LibrePhotos/librephotos/tree/dev/apps/desktop";

const GUIDE = "/docs/user-guide/desktop";

type Shot = { src: string; alt: string };

const SHOTS = {
  timeline: {
    src: "/img/viewer/library-timeline.webp",
    alt: "The LibrePhotos Viewer library in dark mode: a sidebar with Photos, Folders, LibrePhotos and Settings, a search field at the top, and a timeline of photos grouped by day, newest first",
  },
  raw: {
    src: "/img/viewer/raw-photo.webp",
    alt: "A Nikon NEF RAW photo of hairpin bends on a mountain pass, open in the viewer with the Info panel showing the caption, a five star rating, the NIKON D750 camera with 50 mm, f/1.8 and 1/640 s, the XMP sidecar the edits go to, and keywords",
  },
  info: {
    src: "/img/viewer/viewer-info-panel.webp",
    alt: "A photo of a red fox in the viewer with the Info panel open: caption, rating, date taken, file details, folder, Next to the photo (XMP sidecar) with the sidecar file name red-fox.jpg.xmp, and the keywords fox, wildlife and animals",
  },
  search: {
    src: "/img/viewer/search.webp",
    alt: "The library searched for the word nature: 11 matching photos on this computer, grouped by day, one of them marked RAW",
  },
  zoom: {
    src: "/img/viewer/zoom-detail.webp",
    alt: "The red fox photo zoomed to 100 percent, showing single hairs of its fur, with the filmstrip of the folder's other photos along the bottom",
  },
} satisfies Record<string, Shot>;

function Screenshot({ shot, eager = false }: { shot: Shot; eager?: boolean }) {
  return (
    <div className={home.shotFrame}>
      <img
        src={useBaseUrl(shot.src)}
        alt={shot.alt}
        width={1600}
        height={900}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <Icon>
      <path d="M4 8h16l-1 12H5zM9 8V6a3 3 0 0 1 6 0v2" />
    </Icon>
  );
}

function AppleIcon() {
  return (
    <Icon>
      <path d="M8.286 7.008c-3.216 0-4.286 3.23-4.286 5.92 0 3.229 2.143 8.072 4.286 8.072 1.165-.05 1.799-.538 3.214-.538 1.406 0 1.607.538 3.214.538s4.286-3.229 4.286-5.381c-.03-.011-2.649-.434-2.679-3.23-.02-2.336 2.589-3.165 2.679-3.23-1.096-1.61-2.788-2.13-3.214-2.151-1.113-.087-2.201.538-2.679.538-.504 0-1.607-.538-2.678-.538z" />
      <path d="M12 4a2 2 0 0 0 2-2a2 2 0 0 0-2 2" />
    </Icon>
  );
}

function Hero() {
  return (
    <header className={home.hero}>
      <div className={clsx("container", home.heroInner)}>
        <div className={home.heroCopy}>
          <p className={home.eyebrow}>Windows and macOS · Free · Open source</p>
          <h1 className={home.title}>LibrePhotos Viewer, the photo viewer for your own folders.</h1>
          <p className={home.lead}>
            Open camera RAW, HEIC, AVIF and JPEG XL pictures, rate and caption them in XMP sidecars other photo apps
            read, and browse your folders as a timeline you can search. No account, no import, no cloud.
          </p>
          <div className={home.actions}>
            <Link className={clsx(home.button, home.buttonFilled)} href={STORE_URL}>
              Get it from Microsoft Store
            </Link>
            <a className={clsx(home.button, home.buttonDefault)} href="#download">
              Installer and Mac download
            </a>
          </div>
          <p className={home.heroNote}>
            A preview of the LibrePhotos desktop app. <Since version={DESKTOP_SINCE} /> Works on its own, and with
            your <Link to="/">LibrePhotos server</Link> if you run one.
          </p>
        </div>
        <div className={home.heroArt}>
          <Screenshot shot={SHOTS.timeline} eager />
        </div>
      </div>
    </header>
  );
}

type Feature = { id: string; title: string; body: ReactNode; points: ReactNode[]; shot: Shot; more: string };

const FEATURES: Feature[] = [
  {
    id: "raw",
    title: "Camera RAW, with its own decoder",
    body: "RAW files from Canon, Nikon, Sony, Fujifilm, Olympus, Panasonic, Pentax, Samsung, DNG and more open like any other picture, with no codec pack to install.",
    points: [
      "The viewer shows the preview the camera stored in the file, and develops the sensor data itself when you zoom in.",
      "The Info panel lists the camera, lens and exposure, and other values from the file such as the white balance.",
      "JPEG XL has its own decoder too. HEIC, HEIF and AVIF open through the image codecs of Windows or macOS.",
    ],
    shot: SHOTS.raw,
    more: `${GUIDE}/viewer#opening-pictures`,
  },
  {
    id: "sidecars",
    title: "Edits that other photo apps can read",
    body: "Mark favourites, rate with stars, and change the caption, keywords and date taken. By default the picture file itself is never changed.",
    points: [
      "Edits go into an XMP sidecar next to the picture, the file LibrePhotos, digiKam and darktable read. A Lightroom sidecar that is already there is updated.",
      "Everything else in an existing sidecar, such as other apps' settings, is kept.",
      "You can also write into JPEG files without re-compressing them, or keep edits in the app only.",
    ],
    shot: SHOTS.info,
    more: `${GUIDE}/editing#where-edits-are-saved`,
  },
  {
    id: "timeline",
    title: "A timeline of your own folders, and search",
    body: "Add the folders you already have. Nothing is copied or moved: the library shows their pictures and videos newest first, grouped by day, and follows along when you add, change, rename or delete files.",
    points: [
      "Search by file name, folder, date, camera, lens, format, caption or keyword, for example march 2023 canon.",
      "Every word has to match, so a few words narrow it down quickly.",
      "Click a picture to open it, and move through the same list with the arrow keys.",
    ],
    shot: SHOTS.search,
    more: `${GUIDE}/library`,
  },
  {
    id: "viewing",
    title: "Made for going through a folder",
    body: "Double-click a picture in Explorer or Finder and the viewer opens it with the rest of its folder in a filmstrip along the bottom.",
    points: [
      "Zoom with the mouse wheel, fit with 0, and see every pixel at 100 % with 1. Pictures over 24 megapixels are drawn in tiles, so zooming stays smooth.",
      "Rotate JPEG and TIFF files by their orientation tag, without re-compressing them.",
      "Slideshow, full screen, copy to the clipboard, and Delete moves the file to the Recycle Bin or Trash.",
    ],
    shot: SHOTS.zoom,
    more: `${GUIDE}/viewer#moving-around`,
  },
];

function Features() {
  return (
    <section id="features" className={home.section}>
      <div className="container">
        <div className={home.sectionHead}>
          <h2 className={home.h2}>What it does</h2>
          <p className={home.sectionLead}>
            A viewer for the pictures a camera makes, a library of the folders they are in, and edits that stay in
            standard files instead of one app's database.
          </p>
        </div>
        <div className={styles.features}>
          {FEATURES.map((f) => (
            <article key={f.id} id={f.id} className={styles.feature}>
              <div className={styles.featureCopy}>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureBody}>{f.body}</p>
                <ul className={styles.featurePoints}>
                  {f.points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <Link to={f.more} className={styles.more}>
                  How it works
                </Link>
              </div>
              <div className={styles.featureShot}>
                <Screenshot shot={f.shot} />
              </div>
            </article>
          ))}
        </div>
        <p className={styles.shotNote}>The screenshots show a demo library of sample photos.</p>
      </div>
    </section>
  );
}

function Server() {
  return (
    <section id="server" className={clsx(home.section, home.sectionChrome)}>
      <div className={clsx("container", styles.split)}>
        <div>
          <p className={home.eyebrow}>Optional</p>
          <h2 className={home.h2}>Works with your LibrePhotos server</h2>
          <p className={home.sectionLead}>
            The app is complete without a server. If you run <Link to="/">LibrePhotos</Link> at home, sign in and the
            viewer does more.
          </p>
        </div>
        <ul className={styles.cardList}>
          <li className={styles.card}>
            <strong>Back up your library folders</strong>
            <span>
              Every picture and video the server does not have yet is uploaded, and new ones as they arrive. Pictures
              are recognised by their content, so the ones already on the server are skipped.
            </span>
          </li>
          <li className={styles.card}>
            <strong>See what the server found</strong>
            <span>
              For a picture on the server, the Info panel shows the people in it, its albums, the place name and the
              things the server found.
            </span>
          </li>
          <li className={styles.card}>
            <strong>Search both</strong>
            <span>
              The server's search runs next to the local one and finds people, things, places and captions. Choose
              All, This computer or LibrePhotos.
            </span>
          </li>
          <li className={styles.card}>
            <strong>Edits reach the server</strong>
            <span>
              Ratings, captions, keywords and dates you change are sent to the server too. Offline changes wait and
              are sent when it answers again.
            </span>
          </li>
        </ul>
        <p className={styles.splitFoot}>
          <Link to={`${GUIDE}/server`}>Connecting a server and backup</Link>
        </p>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className={home.section}>
      <div className={clsx("container", styles.split)}>
        <div>
          <h2 className={home.h2}>Your pictures stay on your computer</h2>
          <p className={home.sectionLead}>
            There is nothing to sign up for. The app reads your pictures where they are and only goes online for the
            two things you turn on yourself.
          </p>
        </div>
        <ul className={styles.factList}>
          <li>No telemetry, no analytics, no advertising and no account with us.</li>
          <li>Your pictures, your library and your edits stay on your computer.</li>
          <li>
            It only connects to a LibrePhotos server you sign in to, and to OpenStreetMap when you turn on the map in
            Settings.
          </li>
          <li>The LibrePhotos project receives no data from the app.</li>
        </ul>
        <p className={styles.splitFoot}>
          <Link to={`${GUIDE}/privacy`}>Read the privacy policy</Link>
        </p>
      </div>
    </section>
  );
}

type FormatGroup = { name: string; items: string; note: ReactNode };

const FORMATS: FormatGroup[] = [
  {
    name: "Photos",
    items: "JPEG, PNG, GIF, WebP, BMP, TIFF",
    note: "Opened directly.",
  },
  {
    name: "Camera RAW",
    items: "CR2, CR3, NEF, ARW, RAF, ORF, RW2, PEF, SRW, DNG and more",
    note: "Decoded by the app's own RAW decoder.",
  },
  {
    name: "JPEG XL",
    items: "JXL",
    note: "Decoded by the app's own decoder.",
  },
  {
    name: "HEIC, HEIF and AVIF",
    items: "HEIC, HEIF, AVIF",
    note: (
      <>
        Through the system's codecs. On Windows, HEIC needs the HEIF Image Extensions and HEVC Video Extensions, and
        AVIF the AV1 Video Extension, from the Microsoft Store. On a Mac, AVIF needs macOS 13 or later.
      </>
    ),
  },
  {
    name: "Videos",
    items: "MP4, MOV",
    note: "Played in the viewer.",
  },
];

function Formats() {
  return (
    <section id="formats" className={clsx(home.section, home.sectionChrome)}>
      <div className="container">
        <div className={home.sectionHead}>
          <h2 className={home.h2}>Supported formats</h2>
          <p className={home.sectionLead}>
            The full list, with every camera brand, is in{" "}
            <Link to={`${GUIDE}/viewer#opening-pictures`}>Viewing pictures</Link>.
          </p>
        </div>
        <dl className={styles.formats}>
          {FORMATS.map((f) => (
            <div key={f.name} className={styles.format}>
              <dt>{f.name}</dt>
              <dd className={styles.formatItems}>{f.items}</dd>
              <dd className={styles.formatNote}>{f.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

type Download = {
  id: string;
  icon: ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
  available: boolean;
  tonal?: boolean;
};

const DOWNLOADS: Download[] = [
  {
    id: "store",
    icon: <StoreIcon />,
    title: "Microsoft Store",
    body: "Windows 10 and 11. Windows installs and updates it, and it needs no administrator rights.",
    href: STORE_URL,
    cta: "Get it from Microsoft Store",
    available: true,
    tonal: true,
  },
  {
    id: "windows",
    icon: <WindowsIcon />,
    title: "Windows installer",
    body: "64-bit Windows 10 or 11, from GitHub. The installer is not signed yet, so Windows may ask you to confirm with More info and Run anyway.",
    href: WINDOWS_SETUP_URL,
    cta: "Download the installer",
    available: DESKTOP_RELEASED,
  },
  {
    id: "mac",
    icon: <AppleIcon />,
    title: "Mac disk image",
    body: "macOS 12 or later, Apple silicon and Intel, from GitHub. The app is not signed with an Apple Developer ID yet, so you allow it once in System Settings, under Privacy & Security.",
    href: MAC_DMG_URL,
    cta: "Download for Mac",
    available: DESKTOP_RELEASED,
  },
];

function Downloads() {
  return (
    <section id="download" className={home.section}>
      <div className="container">
        <div className={home.sectionHead}>
          <h2 className={home.h2}>Download</h2>
          <p className={home.sectionLead}>
            Free and open source under the MIT license. The installer and disk image are attached to every LibrePhotos
            release from {DESKTOP_SINCE} on. <Link to={`${GUIDE}#installing-it`}>Installing it</Link> has the steps and
            the checksums.
          </p>
        </div>
        <ul className={styles.downloads}>
          {DOWNLOADS.map((d) => (
            <li key={d.id} className={styles.download} data-tonal={d.tonal ? "" : undefined}>
              <span className={styles.downloadIcon}>{d.icon}</span>
              <h3 className={home.h3}>{d.title}</h3>
              <p>{d.body}</p>
              {d.available ? (
                <Link href={d.href} className={styles.downloadCta}>
                  {d.cta}
                </Link>
              ) : (
                <span className={styles.downloadPending}>
                  <Since version={DESKTOP_SINCE} />
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className={styles.shotNote}>
          There is no Linux build yet. To build the app yourself, see{" "}
          <Link to="/docs/development/desktop">Development: Desktop app</Link> and the{" "}
          <Link href={SOURCE_URL}>source code</Link>.
        </p>
      </div>
    </section>
  );
}

type Question = { q: string; a: ReactNode };

const FAQ: Question[] = [
  {
    q: "Do I need a LibrePhotos server?",
    a: "No. The viewer, the library, search and editing all work without one. A server adds backup and what the server knows about your pictures, such as people and albums.",
  },
  {
    q: "Does it copy or move my pictures?",
    a: "No. The library reads your folders where they are, and removing a folder from the library leaves the files alone. By default your edits go into a small sidecar file next to each picture, and the picture itself is not changed.",
  },
  {
    q: "Can it edit the pixels, such as crop or exposure?",
    a: "No. It changes a picture's details: favourite, rating, caption, keywords and date taken. The only change to the picture itself is rotation: JPEG and TIFF files by their orientation tag, PNG and BMP files saved again without loss. Videos cannot be edited yet.",
  },
  {
    q: "Will it become my default photo viewer?",
    a: (
      <>
        Only if you choose it. Installing never changes which app opens your pictures. On Windows, choose{" "}
        <strong>Set as default photo viewer</strong> in the viewer's menu; on a Mac, use <strong>Get Info</strong> in
        Finder. <Link to={`${GUIDE}#installing-it`}>Installing it</Link> has the steps.
      </>
    ),
  },
  {
    q: "Why does a HEIC or AVIF picture not open on Windows?",
    a: "The app shows these through the Windows image codecs. HEIC needs the HEIF Image Extensions and the HEVC Video Extensions, and AVIF the AV1 Video Extension, all from the Microsoft Store. Many PCs come with them.",
  },
  {
    q: "Is it finished?",
    a: "It is a preview: what it does and how it looks can still change. Your edits are in standard XMP sidecars, so other apps can read them whatever happens to this one.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. It is free, open source software under the MIT license, with no subscription and no ads. LibrePhotos is built by volunteers; sponsoring the project keeps it going.",
  },
];

function Faq() {
  return (
    <section id="faq" className={clsx(home.section, home.sectionChrome)}>
      <div className="container">
        <div className={home.sectionHead}>
          <h2 className={home.h2}>Questions</h2>
          <p className={home.sectionLead}>
            More answers are in the <Link to={GUIDE}>desktop app guide</Link>.
          </p>
        </div>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary>{item.q}</summary>
              <div className={styles.faqAnswer}>{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Viewer(): ReactNode {
  return (
    <Layout title="LibrePhotos Viewer for Windows and Mac" description={DESCRIPTION}>
      <Hero />
      <main>
        <Features />
        <Server />
        <Privacy />
        <Formats />
        <Downloads />
        <Faq />
      </main>
    </Layout>
  );
}
