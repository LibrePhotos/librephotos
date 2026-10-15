import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";
import releases from "@site/src/data/releases.json";
import { sinceLabel, sinceState, type SinceIndex } from "@site/src/data/releases";
import styles from "./styles.module.css";

const INDEX: SinceIndex = releases;

type Props = { version: string };

/**
 * `<Since version="1.4.0" />` marks a feature with the release it ships in. It reads
 * src/data/releases.json (generated from the release posts), so the marker flips from
 * "Not released yet" to "New in 1.4.0" when the 1.4.0 post is merged, without touching the page.
 */
export default function Since({ version }: Props): ReactNode {
  const state = sinceState(version, INDEX);
  const label = sinceLabel(state);
  if (state.released) {
    return (
      <Link to={state.permalink} className={styles.since} data-since={version} data-released="true">
        {label}
      </Link>
    );
  }
  return (
    <span className={styles.since} data-since={version} data-released="false">
      {label}
    </span>
  );
}
