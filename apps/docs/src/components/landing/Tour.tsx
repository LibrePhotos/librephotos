import React, { useState, type ReactNode } from "react";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { useColorMode } from "@docusaurus/theme-common";
import styles from "./landing.module.css";

type Stop = { id: string; label: string; title: string; body: string; shot: string };

const STOPS: Stop[] = [
  {
    id: "timeline",
    label: "Timeline",
    title: "Every photo, by day and place",
    body: "The timeline groups your library by the day it was taken and shows where you were. Scroll years in a flick with the scrubber on the right.",
    shot: "timeline",
  },
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
  const { colorMode } = useColorMode();
  const base = useBaseUrl("/img/shots/");
  const src = `${base}${active.shot}-${colorMode === "dark" ? "dark" : "light"}.webp`;

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
          <img key={src} src={src} alt={`${active.label} view of LibrePhotos`} width={1600} height={1000} loading="lazy" />
        </div>
        <p className={styles.tourCaption}>{active.body}</p>
      </div>
    </div>
  );
}
