import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import { ChevronIcon, GROUPS } from "./_shared/groups";
import styles from "./use-cases.module.css";

const DESCRIPTION =
  "Who LibrePhotos is for: photographers, archivists and family historians, families, and self-hosters. What it does for each group today, and who it is not for yet.";

type NotFor = { title: string; body: string; detail: ReactNode };

const NOT_FOR: NotFor[] = [
  {
    title: "Phone-first households",
    body: "If what you need most is automatic backup from every phone in the family, LibrePhotos does not have a released app of its own for that yet.",
    detail: (
      <>
        The official app is not published, and the third-party UhuruPhotos app for Android is in beta. See{" "}
        <Link to="/docs/user-guide/mobile">Mobile apps</Link>.
      </>
    ),
  },
  {
    title: "Schools, newsrooms and companies",
    body: "Organisations that need several editors on one collection, roles beyond admin and user, two-factor sign-in or storage quotas will miss them today.",
    detail: (
      <>
        Every photo has one owner (<Link href="https://github.com/LibrePhotos/librephotos/issues/395">#395</Link>). A
        club archive run from one shared account can work; see the{" "}
        <Link to="/use-cases/archivists">archivists page</Link>.
      </>
    ),
  },
  {
    title: "End-to-end encryption",
    body: "The server reads your photos to make thumbnails, find faces and search them, so whoever runs the server can see them.",
    detail: <>LibrePhotos has no end-to-end encryption. Run it on hardware you trust.</>,
  },
];

export default function UseCases(): ReactNode {
  return (
    <Layout title="Use cases" description={DESCRIPTION}>
      <header className={styles.hero}>
        <div className={clsx("container", styles.heroInner, styles.heroInnerSingle)}>
          <div className={styles.heroCopyWide}>
            <p className={styles.eyebrow}>Use cases</p>
            <h1 className={styles.title}>Who LibrePhotos is for, and what it does for them today.</h1>
            <p className={styles.lead}>
              LibrePhotos is a self-hosted photo server for the library you already have. These pages look at it from
              four kinds of people who use it, with the problems they bring, the features that answer them, and the
              things it does not do yet.
            </p>
          </div>
        </div>
      </header>
      <main>
        <section className={clsx(styles.section, styles.sectionTight)}>
          <div className="container">
            <div className={styles.groupGrid}>
              {GROUPS.map((g) => (
                <Link key={g.slug} to={`/use-cases/${g.slug}`} className={styles.groupCard}>
                  <span className={styles.groupIcon}>{g.icon}</span>
                  <h2 className={styles.h3}>{g.name}</h2>
                  <p>{g.summary}</p>
                  <ul className={styles.groupPoints}>
                    {g.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  <span className={styles.groupCta}>
                    LibrePhotos for {g.name.toLowerCase()}
                    <ChevronIcon className={styles.chevron} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
        <section className={clsx(styles.section, styles.sectionChrome)}>
          <div className="container">
            <div className={styles.sectionHead}>
              <h2 className={styles.h2}>Who it is not for yet</h2>
              <p className={styles.sectionLead}>
                Saying so now saves you a migration later. Each of these may change; the issue tracker and the release
                notes say when.
              </p>
            </div>
            <div className={styles.notForGrid}>
              {NOT_FOR.map((n) => (
                <div key={n.title} className={styles.notForCard}>
                  <h3 className={styles.h3}>{n.title}</h3>
                  <p>{n.body}</p>
                  <p>{n.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className={styles.section}>
          <div className={clsx("container", styles.start)}>
            <div>
              <h2 className={styles.h2}>Not sure yet?</h2>
              <p className={styles.sectionLead}>
                The feature comparison puts LibrePhotos next to fifteen other photo apps, feature by feature, with what
                each one does not have.
              </p>
            </div>
            <div className={styles.actions}>
              <Link className={clsx(styles.button, styles.buttonFilled)} to="/docs/user-guide/features">
                Compare features
              </Link>
              <Link className={clsx(styles.button, styles.buttonDefault)} to="/docs/installation">
                Install LibrePhotos
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
