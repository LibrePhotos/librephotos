import React, { useState, type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import Since from "@site/src/components/Since";
import releases from "@site/src/data/releases.json";
import { sinceState, type SinceIndex } from "@site/src/data/releases";
import {
  planRoadmap,
  ROADMAP,
  type PlannedItem,
  type ReleaseLookup,
  type RoadmapItem,
  type ShippedRelease,
  type Status,
  type Track,
  type VersionedItem,
} from "@site/src/data/roadmap";
import { ChevronIcon, Icon } from "./use-cases/_shared/groups";
import base from "./use-cases/use-cases.module.css";
import styles from "./roadmap.module.css";

const DESCRIPTION =
  "What LibrePhotos has shipped, release by release, and what comes next: new features and new ways to install it, from Docker to the Windows app, the desktop viewer and the app stores.";

const ISSUES_URL = "https://github.com/LibrePhotos/librephotos/issues";

const INDEX: SinceIndex = releases;

const lookup: ReleaseLookup = (version) => {
  if (!sinceState(version, INDEX).released) {
    return null;
  }
  const entry = releases.releases.find((r) => r.versions.includes(version));
  return entry ? { date: entry.date, permalink: entry.permalink } : null;
};

const PLAN = planRoadmap(ROADMAP, lookup);

type Filter = "all" | Track;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "feature", label: "Features" },
  { id: "install", label: "Ways to install" },
];

const TRACK_LABEL: Record<Track, string> = {
  feature: "Feature",
  install: "Install",
};

const STATUS_LABEL: Record<Status, string> = {
  "in-progress": "In progress",
  beta: "Beta",
  planned: "Planned",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

function matches(filter: Filter, item: RoadmapItem): boolean {
  return filter === "all" || item.track === filter;
}

function TrackIcon({ track }: { track: Track }): ReactNode {
  return track === "install" ? (
    <Icon>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </Icon>
  ) : (
    <Icon>
      <path d="M12 3l2.4 5.2 5.6.6-4.2 3.8 1.2 5.5L12 15.3 7 18.1l1.2-5.5L4 8.8l5.6-.6z" />
    </Icon>
  );
}

function TrackTag({ track }: { track: Track }): ReactNode {
  return (
    <span className={styles.track} data-track={track}>
      <TrackIcon track={track} />
      {TRACK_LABEL[track]}
    </span>
  );
}

function linkLabel(item: PlannedItem): string {
  if (item.issue) {
    return `Issue #${item.issue}`;
  }
  if (item.pr) {
    return `Pull request #${item.pr}`;
  }
  return "How it works";
}

function UpcomingCard({ item, chip, cta }: { item: RoadmapItem; chip: ReactNode; cta: string }): ReactNode {
  return (
    <li className={styles.card}>
      <div className={styles.cardMeta}>
        {chip}
        <TrackTag track={item.track} />
      </div>
      <h3 className={base.h3}>{item.title}</h3>
      <p className={styles.cardBody}>{item.body}</p>
      <Link to={item.link} className={base.docLink}>
        {cta}
        <ChevronIcon className={base.chevron} />
      </Link>
    </li>
  );
}

function UpcomingGroup({ title, lead, children }: { title: string; lead: string; children: ReactNode }): ReactNode {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{title}</h3>
        <p className={styles.groupLead}>{lead}</p>
      </div>
      <ul className={styles.cards}>{children}</ul>
    </div>
  );
}

function Upcoming({ filter }: { filter: Filter }): ReactNode {
  const next = PLAN.next.filter((item) => matches(filter, item));
  const planned = PLAN.planned.filter((item) => matches(filter, item));
  return (
    <section id="next" className={clsx(base.section, base.sectionChrome)}>
      <div className="container">
        <div className={base.sectionHead}>
          <h2 className={base.h2}>Coming next</h2>
          <p className={base.sectionLead}>
            No dates, only where each piece stands. Every item links to the issue, the pull request or the docs where
            the work happens.
          </p>
        </div>
        {next.length > 0 && (
          <UpcomingGroup
            title="Done, in the next release"
            lead="Merged and documented. These reach you with the next update."
          >
            {next.map((item: VersionedItem) => (
              <UpcomingCard key={item.id} item={item} chip={<Since version={item.version} />} cta="Read the docs" />
            ))}
          </UpcomingGroup>
        )}
        {planned.length > 0 && (
          <UpcomingGroup title="In progress and planned" lead="Being built, in testing, or agreed on and waiting.">
            {planned.map((item) => (
              <UpcomingCard
                key={item.id}
                item={item}
                chip={
                  <span className={styles.status} data-status={item.status}>
                    {STATUS_LABEL[item.status]}
                  </span>
                }
                cta={linkLabel(item)}
              />
            ))}
          </UpcomingGroup>
        )}
      </div>
    </section>
  );
}

function ReleaseBlock({ release, filter }: { release: ShippedRelease; filter: Filter }): ReactNode {
  const items = release.items.filter((item) => matches(filter, item));
  if (items.length === 0) {
    return null;
  }
  return (
    <li className={styles.release}>
      <div className={styles.releaseHead}>
        <Link to={release.permalink} className={styles.releaseVersion}>
          {release.version}
        </Link>
        <time dateTime={release.date} className={styles.releaseDate}>
          {formatDate(release.date)}
        </time>
      </div>
      <ul className={styles.milestones}>
        {items.map((item) => (
          <li key={item.id} className={styles.milestone}>
            <TrackTag track={item.track} />
            <div>
              <Link to={item.link} className={styles.milestoneTitle}>
                {item.title}
              </Link>
              <p className={styles.milestoneBody}>{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Shipped({ filter }: { filter: Filter }): ReactNode {
  return (
    <section id="shipped" className={base.section}>
      <div className="container">
        <div className={base.sectionHead}>
          <h2 className={base.h2}>Shipped</h2>
          <p className={base.sectionLead}>
            The milestones of each release, newest first. The version opens its release notes, the title the part of the
            docs that explains it.
          </p>
        </div>
        <ol className={styles.timeline}>
          {PLAN.shipped.map((release) => (
            <ReleaseBlock key={release.version} release={release} filter={filter} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function FilterBar({ filter, onChange }: { filter: Filter; onChange: (filter: Filter) => void }): ReactNode {
  return (
    <div className={base.sectionNav}>
      <div className={clsx("container", base.sectionNavInner)} role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={clsx(base.chip, styles.filter)}
            aria-pressed={filter === f.id}
            onClick={() => onChange(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span className={styles.navSpacer} />
        <a className={base.chip} href="#next">
          Coming next
        </a>
        <a className={base.chip} href="#shipped">
          Shipped
        </a>
      </div>
    </div>
  );
}

function Facts(): ReactNode {
  const latest = PLAN.shipped.find((r) => r.version === INDEX.latest);
  const milestones = PLAN.shipped.reduce((sum, r) => sum + r.items.length, 0);
  const upcoming = PLAN.next.length + PLAN.planned.length;
  return (
    <dl className={styles.facts}>
      <div className={styles.fact}>
        <dt>Latest release</dt>
        <dd>
          {latest ? <Link to={latest.permalink}>{latest.version}</Link> : INDEX.latest}
          {latest && <span className={styles.factNote}>{formatDate(latest.date)}</span>}
        </dd>
      </div>
      <div className={styles.fact}>
        <dt>Milestones shipped</dt>
        <dd>{milestones}</dd>
      </div>
      <div className={styles.fact}>
        <dt>Coming next</dt>
        <dd>{upcoming}</dd>
      </div>
    </dl>
  );
}

export default function Roadmap(): ReactNode {
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <Layout title="Roadmap" description={DESCRIPTION}>
      <header className={base.hero}>
        <div className={clsx("container", base.heroInner, base.heroInnerSingle)}>
          <div className={base.heroCopyWide}>
            <p className={base.eyebrow}>Roadmap</p>
            <h1 className={base.title}>What LibrePhotos does today, and what comes next.</h1>
            <p className={base.lead}>
              Features and new ways to get LibrePhotos, from Docker and the single container to the Windows app, the desktop
              viewer and the app stores. Shipped work comes from the release notes; what is next links to the work
              itself.
            </p>
            <Facts />
          </div>
        </div>
      </header>
      <FilterBar filter={filter} onChange={setFilter} />
      <main>
        <Upcoming filter={filter} />
        <Shipped filter={filter} />
        <section className={clsx(base.section, base.sectionChrome)}>
          <div className={clsx("container", base.start)}>
            <div>
              <h2 className={base.h2}>Help decide what comes next</h2>
              <p className={base.sectionLead}>
                Add a thumbs-up to the issues you want most, or open one for what is missing. The release notes say
                when each piece lands.
              </p>
            </div>
            <div className={base.actions}>
              <Link className={clsx(base.button, base.buttonFilled)} href={ISSUES_URL}>
                Open issues
              </Link>
              <Link className={clsx(base.button, base.buttonDefault)} to="/blog">
                Release notes
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
