import React, { type ReactNode } from "react";
import useBaseUrl from "@docusaurus/useBaseUrl";
import ThemedImage from "@theme/ThemedImage";
import { shotPath } from "@site/src/data/shots";
import { shotInfo } from "./manifest";
import styles from "./styles.module.css";

type Props = {
  /** A shot id from static/img/shots/manifest.json; an unknown id fails the build. */
  id: string;
  /** Overrides the manifest's alt text, for a post that needs to point at something else in the shot. */
  alt?: string;
  /** Visible text under the shot. The alt text is never shown, so this does not repeat it. */
  caption?: string;
};

/**
 * `<Screenshot id="timeline" />` shows the light shot in the light theme and the dark shot in the
 * dark theme, with the alt text, width and height from the manifest. In the GitHub release body the
 * release scripts turn it into a `<picture>` (scripts/lib/release-posts.mjs).
 *
 * The image sits in its own wrapper inside the figure, so a phone shot can be added later as a
 * `<source>` for narrow screens without changing the figure (#2307).
 */
export default function Screenshot({ id, alt, caption }: Props): ReactNode {
  const light = useBaseUrl(shotPath(id, "light"));
  const dark = useBaseUrl(shotPath(id, "dark"));
  const shot = shotInfo(id);
  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        <ThemedImage
          className={styles.image}
          sources={{ light, dark }}
          alt={alt ?? shot.alt}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          decoding="async"
        />
      </div>
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
