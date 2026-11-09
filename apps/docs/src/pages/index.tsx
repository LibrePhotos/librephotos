import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import ThemedImage from "@theme/ThemedImage";
import { shotInfo } from "@site/src/components/Screenshot/manifest";
import { shotPath } from "@site/src/data/shots";
import Tour from "@site/src/components/landing/Tour";
import WhatsNew from "@site/src/components/landing/WhatsNew";
import landing from "@site/src/components/landing/landing.module.css";

import styles from "./index.module.css";

const DESCRIPTION =
  "LibrePhotos is a self-hosted, open source photo management service. Faces, places, events and semantic search, with every photo and every byte of metadata staying on your own machine.";

const SPONSORS_URL = "https://github.com/sponsors/derneuere";
// Who took the sample photos in the screenshots, kept next to them.
const CREDITS_URL = "https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/static/img/shots/CREDITS.md";
const PAYPAL_URL = "https://www.paypal.com/donate/?hosted_button_id=5JWVM2UR4LM96";
// Every release from 1.2.0 on carries the zip (standalone-windows workflow), so /latest/download always resolves.
const WINDOWS_ZIP_URL = "https://github.com/LibrePhotos/librephotos/releases/latest/download/librephotos-windows-x64.zip";

/**
 * The timeline as the app shows it, in the theme the page is read in. Lazy on purpose: the server
 * renders both themes' images and hides one, and a lazy image that is hidden is never fetched.
 */
function HeroShot() {
  const shot = shotInfo("timeline");
  const light = useBaseUrl(shotPath(shot.id, "light"));
  const dark = useBaseUrl(shotPath(shot.id, "dark"));
  return (
    <div className={styles.heroArt}>
      <div className={styles.shotFrame}>
        <ThemedImage
          sources={{ light, dark }}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z" />
    </svg>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={clsx("container", styles.heroInner)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Self-hosted · Open source · MIT licensed</p>
          <h1 className={styles.title}>The photo library that stays on your machine.</h1>
          <p className={styles.lead}>
            LibrePhotos scans the folders you already have, finds the faces, places and events in
            them, and makes everything searchable. Nothing is sent to a third party. Not a photo,
            not a byte of metadata.
          </p>
          <div className={styles.actions}>
            <Link className={clsx(styles.button, styles.buttonFilled)} to="/docs/installation">
              Install LibrePhotos
            </Link>
            <a className={clsx(styles.button, styles.buttonDefault)} href="#tour">
              See it in action
            </a>
          </div>
          <a className={styles.windowsLink} href={WINDOWS_ZIP_URL}>
            <span className={styles.windowsIcon}>
              <WindowsIcon />
            </span>
            <span>
              <strong>Download for Windows</strong>
              <span className={styles.windowsSub}>One program, no Docker or Python needed</span>
            </span>
          </a>
          <p className={styles.heroNote}>
            Runs with Docker, Kubernetes or Unraid, or as a standalone program on Windows (
            <Link to="/docs/installation/windows-standalone">how it works</Link>). Android app included. Built
            by volunteers, so <Link href={SPONSORS_URL}>sponsoring</Link> keeps it going.
          </p>
        </div>
        <HeroShot />
      </div>
    </header>
  );
}

function WhatsNewSection() {
  return (
    <section id="new" className={styles.section}>
      <div className="container">
        <WhatsNew />
      </div>
    </section>
  );
}

function TourSection() {
  return (
    <section id="tour" className={clsx(styles.section, styles.sectionChrome)}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>A look around</h2>
          <p className={styles.sectionLead}>
            A sample library. The screenshots follow the theme you are reading in.
          </p>
        </div>
        <Tour />
        <p className={landing.credits}>
          Sample photos from Unsplash and others, see the <Link href={CREDITS_URL}>credits</Link>.
        </p>
      </div>
    </section>
  );
}

type Path = { title: string; body: string; to: string; cta: string; icon: ReactNode };

/** Outline icons in the app's style (Tabler, stroke 1.75). */
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

const PATHS: Path[] = [
  {
    title: "Install",
    body: "Pick a deployment: a single container, Docker Compose, Kubernetes, Unraid, or the standalone Windows build. Most people are done in ten minutes.",
    to: "/docs/installation",
    cta: "Installation guides",
    icon: (
      <Icon>
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12" />
      </Icon>
    ),
  },
  {
    title: "First steps",
    body: "Point LibrePhotos at your photos, run the first scan, and set up accounts for the rest of the household.",
    to: "/docs/user-guide/first-steps",
    cta: "After the first login",
    icon: (
      <Icon>
        <path d="M15 8h.01M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
        <path d="m3 16 5-5c.928-.893 2.072-.893 3 0l5 5" />
        <path d="m14 14 1-1c.928-.893 2.072-.893 3 0l3 3" />
      </Icon>
    ),
  },
  {
    title: "Contribute",
    body: "Get a development environment running, learn how the backend and frontend fit together, and send a pull request.",
    to: "/docs/development",
    cta: "Development setup",
    icon: (
      <Icon>
        <path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />
      </Icon>
    ),
  },
];

function StartHere() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Start here</h2>
          <p className={styles.sectionLead}>Three doors into the documentation, depending on what you came for.</p>
        </div>
        <div className={styles.pathGrid}>
          {PATHS.map((p) => (
            <Link key={p.title} to={p.to} className={styles.pathCard}>
              <span className={styles.pathIcon}>{p.icon}</span>
              <h3 className={styles.h3}>{p.title}</h3>
              <p>{p.body}</p>
              <span className={styles.pathCta}>
                {p.cta}
                <ChevronIcon />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChevronIcon() {
  return (
    <svg
      className={styles.chevron}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Sponsor() {
  return (
    <section id="sponsor" className={styles.section}>
      <div className="container">
        <div className={landing.sponsor}>
          <div>
            <p className={styles.eyebrow}>Support the project</p>
            <h2 className={styles.h2}>No company. No product key. Just people who want their photos back.</h2>
            <p className={styles.sectionLead}>
              LibrePhotos is maintained by volunteers in their spare time. There is no venture money and nothing
              is held back for a paid tier. If it saves you a subscription, consider passing a little of that on.
              Sponsorship pays for the hardware the models are tested on and the hours that go into releases.
            </p>
            <ul className={landing.sponsorFacts}>
              <li>
                <strong>MIT</strong>licensed, forever
              </li>
              <li>
                <strong>0</strong>trackers or phone-home
              </li>
              <li>
                <strong>100%</strong>volunteer built
              </li>
            </ul>
          </div>
          <div className={landing.sponsorCards}>
            <Link href={SPONSORS_URL} className={landing.sponsorCard} data-tonal="">
              <span className={landing.sponsorIcon}>
                <Icon>
                  <path d="M19.5 12.572 12 20l-7.5-7.428A5 5 0 1 1 12 6.006a5 5 0 1 1 7.5 6.572" />
                </Icon>
              </span>
              <span>
                <strong>Sponsor on GitHub</strong>
                <span>Monthly or one-off, from a few euros. Shows up in the release notes.</span>
              </span>
            </Link>
            <Link href={PAYPAL_URL} className={landing.sponsorCard}>
              <span className={landing.sponsorIcon}>
                <Icon>
                  <path d="M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 10h18M7 15h.01M11 15h2" />
                </Icon>
              </span>
              <span>
                <strong>Donate with PayPal</strong>
                <span>A one-time thank you, no account on GitHub needed.</span>
              </span>
            </Link>
            <Link to="/docs/development" className={landing.sponsorCard}>
              <span className={landing.sponsorIcon}>
                <Icon>
                  <path d="m7 8-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />
                </Icon>
              </span>
              <span>
                <strong>Contribute code or translations</strong>
                <span>Every pull request and Weblate string counts just as much.</span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const TOOLS: { name: string; role: string; href: string }[] = [
  { name: "libvips", role: "image conversion", href: "https://github.com/libvips/libvips" },
  { name: "FFmpeg", role: "video", href: "https://github.com/FFmpeg/FFmpeg" },
  { name: "ExifTool", role: "metadata", href: "https://github.com/exiftool/exiftool" },
  { name: "InsightFace", role: "face detection", href: "https://github.com/deepinsight/insightface" },
  { name: "OpenCLIP", role: "tags and semantic search", href: "https://github.com/mlfoundations/open_clip" },
  { name: "LFM2-VL", role: "captions", href: "https://huggingface.co/LiquidAI/LFM2-VL-450M" },
  { name: "ONNX Runtime", role: "runs the models", href: "https://onnxruntime.ai/" },
  { name: "Nominatim", role: "reverse geocoding", href: "https://nominatim.openstreetmap.org/" },
];

const COMMUNITY: { title: string; body: string; href: string }[] = [
  { title: "GitHub", body: "Source code, issues and pull requests.", href: "https://github.com/LibrePhotos/librephotos" },
  { title: "Discord", body: "Ask questions and talk to other users.", href: "https://discord.com/invite/xwRvtSDGWb" },
  { title: "Release notes", body: "What changed in each release.", href: "/blog" },
  { title: "Weblate", body: "Translate the interface into your language.", href: "https://hosted.weblate.org/engage/librephotos/" },
];

function BuiltOnAndCommunity() {
  return (
    <section className={clsx(styles.section, styles.sectionTight)}>
      <div className="container">
        <div className={styles.builtOn}>
          <h2 className={clsx(styles.h2, styles.builtOnTitle)}>Built on open tools</h2>
          <ul className={styles.toolList}>
            {TOOLS.map((t) => (
              <li key={t.name}>
                <Link href={t.href} className={styles.tool}>
                  <span className={styles.toolName}>{t.name}</span>
                  <span className={styles.toolRole}>{t.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.builtOn}>
          <h2 className={clsx(styles.h2, styles.builtOnTitle)}>Join in</h2>
          <ul className={styles.communityList}>
            {COMMUNITY.map((c) => (
              <li key={c.title}>
                <Link href={c.href} className={styles.communityLink}>
                  <span className={styles.communityTitle}>{c.title}</span>
                  <span className={styles.communityBody}>{c.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout title="Self-hosted photo management" description={DESCRIPTION}>
      <Hero />
      <main>
        <WhatsNewSection />
        <TourSection />
        <StartHere />
        <Sponsor />
        <BuiltOnAndCommunity />
      </main>
    </Layout>
  );
}
