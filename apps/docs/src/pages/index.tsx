import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { useColorMode } from "@docusaurus/theme-common";
import Layout from "@theme/Layout";
import Tour from "@site/src/components/landing/Tour";
import landing from "@site/src/components/landing/landing.module.css";

import styles from "./index.module.css";

const DESCRIPTION =
  "LibrePhotos is a self-hosted, open source photo management service. Faces, places, events and semantic search, with every photo and every byte of metadata staying on your own machine.";

const SPONSORS_URL = "https://github.com/sponsors/derneuere";
const PAYPAL_URL = "https://www.paypal.com/donate/?hosted_button_id=5JWVM2UR4LM96";

function DiamondMotif() {
  return (
    <svg className={styles.motif} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M100 5 195 100 100 195 5 100Z" />
        <path d="M100 20 180 100 100 180 20 100Z" />
        <path d="M100 35 165 100 100 165 35 100Z" />
        <path d="M100 50 150 100 100 150 50 100Z" />
      </g>
    </svg>
  );
}

function HeroShot() {
  const shots = useBaseUrl("/img/shots/");
  return (
    <div className={styles.heroArt}>
      <div className={styles.browserFrame}>
        <div className={styles.browserBar} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <img
          src={`${shots}timeline-dark.webp`}
          alt="The LibrePhotos timeline: photos grouped by day, with the places they were taken"
          width={1600}
          height={1000}
          loading="eager"
        />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <DiamondMotif />
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
            <Link className={clsx("button button--lg", styles.primaryButton)} to="/docs/installation">
              Install LibrePhotos
            </Link>
            <a className={clsx("button button--lg", styles.ghostButton)} href="#tour">
              See it in action
            </a>
          </div>
          <p className={styles.heroNote}>
            Runs with Docker, Kubernetes or Unraid. Android app included. Built by volunteers, so{" "}
            <Link href={SPONSORS_URL} className={styles.heroNoteLink}>
              sponsoring
            </Link>{" "}
            keeps it going.
          </p>
        </div>
        <HeroShot />
      </div>
    </header>
  );
}

function TourSection() {
  return (
    <section id="tour" className={clsx(styles.section, styles.sectionTinted)}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>A look around</h2>
          <p className={styles.sectionLead}>
            The current release with a sample library. The screenshots follow the theme you are reading in.
          </p>
        </div>
        <Tour />
        <p className={landing.credits}>
          Sample photos from Pexels by ALEKSANDAR PASARIC, Alexander Ruiz, Anna Tarazevich, Anton Kudryashov, Federico Abis, Fernando B M, H.DUNG, Johannes Plenio, Kampus Production, Kevin Schmidt, Kirill Lazarev, Masood Aslami, Naimish Verma, Polina Tankilevitch, Theo Felten, Tima Miroshnichenko, Travel with Lenses, Tutolo Design, Willian Justen de Vasconcellos, Yaroslav Shuraev, karim desouki. Dates and locations were added for the demo.
        </p>
      </div>
    </section>
  );
}

type Path = { title: string; body: string; to: string; cta: string };

const PATHS: Path[] = [
  {
    title: "Install",
    body: "Pick a deployment: a single container, Docker Compose, Kubernetes or Unraid. Most people are done in ten minutes.",
    to: "/docs/installation",
    cta: "Installation guides",
  },
  {
    title: "First steps",
    body: "Point LibrePhotos at your photos, run the first scan, and set up accounts for the rest of the household.",
    to: "/docs/user-guide/first-steps",
    cta: "After the first login",
  },
  {
    title: "Contribute",
    body: "Get a development environment running, learn how the backend and frontend fit together, and send a pull request.",
    to: "/docs/development",
    cta: "Development setup",
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
              <h3 className={styles.h3}>{p.title}</h3>
              <p>{p.body}</p>
              <span className={styles.pathCta}>{p.cta} →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.6-9.2C1 8.3 3.2 4.5 6.9 4.5c2 0 3.5 1.1 4.3 2.4.8-1.3 2.3-2.4 4.3-2.4 3.7 0 5.9 3.8 4.5 7.3C19.5 16.4 12 21 12 21Z" />
    </svg>
  );
}

function Sponsor() {
  return (
    <section id="sponsor" className={styles.community}>
      <div className="container">
        <div className={landing.sponsor}>
          <div>
            <p className={styles.eyebrow}>Support the project</p>
            <h2 className={styles.h2}>No company. No product key. Just people who want their photos back.</h2>
            <p className={clsx(styles.sectionLead, styles.onInk)}>
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
            <Link href={SPONSORS_URL} className={landing.sponsorCard} data-primary="">
              <span className={landing.sponsorIcon}>
                <HeartIcon />
              </span>
              <span>
                <strong>Sponsor on GitHub</strong>
                <span>Monthly or one-off, from a few euros. Shows up in the release notes.</span>
              </span>
            </Link>
            <Link href={PAYPAL_URL} className={landing.sponsorCard}>
              <span className={landing.sponsorIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="6" width="18" height="12" rx="2" />
                  <path d="M3 10h18M7 14h3" strokeLinecap="round" />
                </svg>
              </span>
              <span>
                <strong>Donate with PayPal</strong>
                <span>A one-time thank you, no account on GitHub needed.</span>
              </span>
            </Link>
            <Link to="/docs/development" className={landing.sponsorCard}>
              <span className={landing.sponsorIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
  { name: "MobileCLIP", role: "tagging", href: "https://github.com/apple/ml-mobileclip" },
  { name: "CLIP", role: "semantic search", href: "https://github.com/openai/CLIP" },
  { name: "LFM2-VL", role: "captions", href: "https://huggingface.co/LiquidAI/LFM2-VL-450M" },
  { name: "ONNX Runtime", role: "runs the models", href: "https://onnxruntime.ai/" },
  { name: "Nominatim", role: "reverse geocoding", href: "https://nominatim.openstreetmap.org/" },
];

const COMMUNITY: { title: string; body: string; href: string }[] = [
  { title: "GitHub", body: "Source code, issues and pull requests.", href: "https://github.com/LibrePhotos/librephotos" },
  { title: "Discord", body: "Ask questions and talk to other users.", href: "https://discord.com/invite/xwRvtSDGWb" },
  { title: "Release notes", body: "What changed, week by week.", href: "/blog" },
  { title: "Weblate", body: "Translate the interface into your language.", href: "https://hosted.weblate.org/engage/librephotos/" },
];

function BuiltOnAndCommunity() {
  return (
    <section className={styles.section}>
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
        <TourSection />
        <StartHere />
        <Sponsor />
        <BuiltOnAndCommunity />
      </main>
    </Layout>
  );
}
