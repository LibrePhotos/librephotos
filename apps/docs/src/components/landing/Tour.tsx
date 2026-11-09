import React, { useState, type ReactNode } from "react";
import useBaseUrl from "@docusaurus/useBaseUrl";
import ThemedImage from "@theme/ThemedImage";
import { shotInfo } from "@site/src/components/Screenshot/manifest";
import { shotPath } from "@site/src/data/shots";
import styles from "./landing.module.css";

type Stop = { id: string; label: string; title: string; body: string; shot: string };

// The timeline is the hero's shot, so the tour starts at the next stop.
const STOPS: Stop[] = [
  {
    id: "lightbox",
    label: "Photo details",
    title: "What LibrePhotos knows about a photo",
    body: "Open a photo and the sidebar lists the people in it, where it was taken, its camera settings, the tags the model assigned and a generated caption.",
    shot: "lightbox",
  },
  {
    id: "faces",
    label: "Faces",
    title: "People, sorted for you",
    body: "Faces are detected and clustered without any input. You name a person once, confirm or reject the suggestions, and the rest is automatic.",
    shot: "faces",
  },
  {
    id: "places",
    label: "Places",
    title: "Your photos on a map",
    body: "GPS tags become named places through reverse geocoding. Browse by country, city or neighbourhood, or click straight into the map.",
    shot: "places",
  },
  {
    id: "events",
    label: "Events",
    title: "Albums that make themselves",
    body: "Days out become albums named after when and where they happened, like “Saturday in Lisbon”, with the people who were there.",
    shot: "events",
  },
];

export default function Tour(): ReactNode {
  const [active, setActive] = useState(STOPS[0]);
  const light = useBaseUrl(shotPath(active.shot, "light"));
  const dark = useBaseUrl(shotPath(active.shot, "dark"));
  const shot = shotInfo(active.shot);

  return (
    <div className={styles.tour}>
      <div className={styles.tourNav} role="tablist" aria-label="Product tour">
        {STOPS.map((s) => (
          <button
            key={s.id}
            role="tab"
            type="button"
            id={`tour-tab-${s.id}`}
            aria-selected={s.id === active.id}
            aria-controls="tour-panel"
            className={styles.tourTab}
            onClick={() => setActive(s)}
          >
            <strong>{s.label}</strong>
            <span>{s.title}</span>
          </button>
        ))}
      </div>
      <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${active.id}`} className={styles.tourPanel}>
        <div className={styles.tourFrame}>
          {/* Lazy, so the theme the page is not shown in is never fetched. */}
          <ThemedImage
            key={active.shot}
            sources={{ light, dark }}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            loading="lazy"
            decoding="async"
          />
        </div>
        <p className={styles.tourCaption}>{active.body}</p>
      </div>
    </div>
  );
}
