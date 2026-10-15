import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import releases from "@site/src/data/releases.json";
import styles from "./landing.module.css";

/** The release title without its "1.3.0: " prefix, which the label above it already says. */
function headline(title: string, release: string): string {
  return title.startsWith(`${release}: `) ? title.slice(release.length + 2) : title;
}

/**
 * "New in <latest>": the highlights of the newest release post, from src/data/releases.json
 * (generated from the blog front matter by scripts/build-releases.mjs).
 */
export default function WhatsNew(): ReactNode {
  const latest = releases.releases[0];
  if (!latest || latest.highlights.length === 0) {
    return null;
  }
  return (
    <div className={styles.whatsNew}>
      <p className={styles.whatsNewLabel}>New in {latest.release}</p>
      <h2 className={styles.whatsNewTitle}>{headline(latest.title, latest.release)}</h2>
      <p className={styles.whatsNewLead}>{latest.summary}</p>
      <ul className={styles.whatsNewList}>
        {latest.highlights.map((h) => (
          <li key={h.id}>
            <Link to={h.learn_more} className={styles.whatsNewCard}>
              {h.audience === "admin" && <span className={styles.whatsNewAudience}>For admins</span>}
              <strong>{h.title}</strong>
              <span>{h.body}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className={styles.whatsNewLinks}>
        <Link to={latest.permalink}>Read the {latest.release} release notes →</Link>
        <Link to="/blog">All releases</Link>
      </p>
    </div>
  );
}
