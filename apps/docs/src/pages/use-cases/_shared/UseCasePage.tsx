import React, { type ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import ThemedImage from "@theme/ThemedImage";
import Since from "@site/src/components/Since";
import { shotInfo } from "@site/src/components/Screenshot/manifest";
import { shotPath } from "@site/src/data/shots";
import { ChevronIcon, GROUPS, groupBySlug, type GroupSlug } from "./groups";
import styles from "../use-cases.module.css";

const CREDITS_URL = "https://github.com/LibrePhotos/librephotos/blob/dev/apps/docs/static/img/shots/CREDITS.md";

export type DocLink = { label: string; to: string };

export type Shot =
  | { kind: "app"; id: string; phone?: boolean; caption?: ReactNode }
  | { kind: "file"; src: string; alt: string; width: number; height: number; caption?: ReactNode };

export type Problem = {
  said: string;
  title: string;
  body: ReactNode;
  links: DocLink[];
  since?: string;
};

export type Showcase = {
  eyebrow: string;
  title: string;
  body: ReactNode;
  shot: Shot;
  links: DocLink[];
  since?: string;
};

export type DayStep = { when: string; title: string; body: ReactNode };

export type Gap = { title: string; body: ReactNode };

export type Action = { label: string; to: string; filled?: boolean; plainHref?: boolean };

export type Faq = { q: string; a: ReactNode };

export type UseCase = {
  slug: GroupSlug;
  pageTitle: string;
  description: string;
  title: string;
  lead: ReactNode;
  hero: Shot;
  problemsLead: ReactNode;
  problems: Problem[];
  showcase?: Showcase;
  day: DayStep[];
  dayLead: ReactNode;
  gaps: Gap[];
  gapsLead: ReactNode;
  start: { lead: ReactNode; actions: Action[]; note?: ReactNode };
  faq: Faq[];
};

const SECTIONS: { id: string; label: string }[] = [
  { id: "problems", label: "Problems and answers" },
  { id: "a-day", label: "A day with LibrePhotos" },
  { id: "not-yet", label: "Not yet" },
  { id: "get-started", label: "Get started" },
  { id: "faq", label: "FAQ" },
];

function ShotImage({ shot, eager }: { shot: Shot; eager?: boolean }): ReactNode {
  const id = shot.kind === "app" ? shot.id : "";
  const file = shot.kind === "app" && shot.phone ? `${id}-phone` : id;
  const light = useBaseUrl(shot.kind === "app" ? shotPath(file, "light") : shot.src);
  const dark = useBaseUrl(shot.kind === "app" ? shotPath(file, "dark") : shot.src);
  const loading = eager ? "eager" : "lazy";
  if (shot.kind === "app") {
    const info = shotInfo(id);
    const size = shot.phone && info.phone ? info.phone : info;
    return (
      <ThemedImage
        sources={{ light, dark }}
        alt={info.alt}
        width={size.width}
        height={size.height}
        loading="lazy"
        decoding="async"
      />
    );
  }
  return <img src={light} alt={shot.alt} width={shot.width} height={shot.height} loading={loading} decoding="async" />;
}

function Figure({ shot, eager }: { shot: Shot; eager?: boolean }): ReactNode {
  return (
    <figure className={clsx(styles.figure, shot.kind === "app" && shot.phone ? styles.figurePhone : undefined)}>
      <div className={styles.shotFrame}>
        <ShotImage shot={shot} eager={eager} />
      </div>
      {shot.caption ? <figcaption className={styles.figcaption}>{shot.caption}</figcaption> : null}
    </figure>
  );
}

function ActionButton({ action }: { action: Action }): ReactNode {
  const className = clsx(styles.button, action.filled ? styles.buttonFilled : styles.buttonDefault);
  const href = useBaseUrl(action.to);
  if (action.plainHref) {
    return (
      <a className={className} href={href}>
        {action.label}
      </a>
    );
  }
  return (
    <Link className={className} to={action.to}>
      {action.label}
    </Link>
  );
}

function DocLinks({ links }: { links: DocLink[] }): ReactNode {
  return (
    <ul className={styles.docLinks}>
      {links.map((l) => (
        <li key={l.to}>
          <Link to={l.to} className={styles.docLink}>
            {l.label}
            <ChevronIcon className={styles.chevron} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Hero({ useCase }: { useCase: UseCase }): ReactNode {
  const group = groupBySlug(useCase.slug);
  return (
    <header className={styles.hero}>
      <div className={clsx("container", styles.heroInner)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <Link to="/use-cases" className={styles.eyebrowLink}>
              Use cases
            </Link>
            <span aria-hidden="true"> / </span>
            {group.name}
          </p>
          <h1 className={styles.title}>{useCase.title}</h1>
          <p className={styles.lead}>{useCase.lead}</p>
          <div className={styles.actions}>
            <a className={clsx(styles.button, styles.buttonFilled)} href="#get-started">
              Get started
            </a>
            <a className={clsx(styles.button, styles.buttonDefault)} href="#problems">
              How it helps
            </a>
          </div>
        </div>
        <div className={styles.heroArt}>
          <Figure shot={useCase.hero} eager />
        </div>
      </div>
    </header>
  );
}

function SectionNav(): ReactNode {
  return (
    <nav className={styles.sectionNav} aria-label="On this page">
      <div className={clsx("container", styles.sectionNavInner)}>
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={styles.chip}>
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Problems({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <section id="problems" className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Sound familiar?</h2>
          <p className={styles.sectionLead}>{useCase.problemsLead}</p>
        </div>
        <div className={styles.problemGrid}>
          {useCase.problems.map((p) => (
            <article key={p.title} className={styles.problemCard}>
              <p className={styles.problemSaid}>{p.said}</p>
              <h3 className={styles.h3}>
                {p.title}
                {p.since ? (
                  <>
                    {" "}
                    <Since version={p.since} />
                  </>
                ) : null}
              </h3>
              <div className={styles.problemBody}>{p.body}</div>
              <DocLinks links={p.links} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShowcaseSection({ showcase }: { showcase: Showcase }): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionChrome)}>
      <div className={clsx("container", styles.showcase)}>
        <div className={styles.showcaseCopy}>
          <p className={styles.eyebrow}>{showcase.eyebrow}</p>
          <h2 className={styles.h2}>{showcase.title}</h2>
          {showcase.since ? (
            <p className={styles.sinceLine}>
              <Since version={showcase.since} />
            </p>
          ) : null}
          <div className={styles.showcaseBody}>{showcase.body}</div>
          <DocLinks links={showcase.links} />
        </div>
        <Figure shot={showcase.shot} />
      </div>
    </section>
  );
}

function Day({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <section id="a-day" className={clsx(styles.section, useCase.showcase ? undefined : styles.sectionChrome)}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>A day with LibrePhotos</h2>
          <p className={styles.sectionLead}>{useCase.dayLead}</p>
        </div>
        <ol className={styles.dayList}>
          {useCase.day.map((step) => (
            <li key={step.title} className={styles.dayItem}>
              <span className={styles.dayWhen}>{step.when}</span>
              <div>
                <h3 className={styles.h3}>{step.title}</h3>
                <div className={styles.dayBody}>{step.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Gaps({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <section id="not-yet" className={styles.section}>
      <div className="container">
        <div className={styles.gapPanel}>
          <div className={styles.sectionHead}>
            <h2 className={styles.h2}>What LibrePhotos does not do for you yet</h2>
            <p className={styles.sectionLead}>{useCase.gapsLead}</p>
          </div>
          <ul className={styles.gapList}>
            {useCase.gaps.map((g) => (
              <li key={g.title}>
                <strong>{g.title}</strong>
                <span>{g.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Start({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <section id="get-started" className={clsx(styles.section, styles.sectionChrome)}>
      <div className={clsx("container", styles.start)}>
        <div>
          <h2 className={styles.h2}>Get started</h2>
          <div className={styles.sectionLead}>{useCase.start.lead}</div>
        </div>
        <div>
          <div className={styles.actions}>
            {useCase.start.actions.map((a) => (
              <ActionButton key={a.to} action={a} />
            ))}
          </div>
          {useCase.start.note ? <p className={styles.startNote}>{useCase.start.note}</p> : null}
        </div>
      </div>
    </section>
  );
}

function FaqSection({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <section id="faq" className={styles.section}>
      <div className="container">
        <div className={styles.sectionHead}>
          <h2 className={styles.h2}>Questions</h2>
        </div>
        <div className={styles.faqList}>
          {useCase.faq.map((f) => (
            <details key={f.q} className={styles.faq}>
              <summary>{f.q}</summary>
              <div className={styles.faqAnswer}>{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Others({ slug }: { slug: GroupSlug }): ReactNode {
  const others = GROUPS.filter((g) => g.slug !== slug);
  return (
    <section className={clsx(styles.section, styles.sectionTight)}>
      <div className="container">
        <div className={styles.othersHead}>
          <h2 className={clsx(styles.h2, styles.othersTitle)}>Other use cases</h2>
          <Link to="/use-cases" className={styles.docLink}>
            All use cases
            <ChevronIcon className={styles.chevron} />
          </Link>
        </div>
        <ul className={styles.otherList}>
          {others.map((g) => (
            <li key={g.slug}>
              <Link to={`/use-cases/${g.slug}`} className={styles.otherLink}>
                <span className={styles.otherIcon}>{g.icon}</span>
                <span className={styles.otherName}>{g.name}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className={styles.credits}>
          Screenshots show a sample library. Sample photos from Unsplash and others, see the{" "}
          <Link href={CREDITS_URL}>credits</Link>.
        </p>
      </div>
    </section>
  );
}

export default function UseCasePage({ useCase }: { useCase: UseCase }): ReactNode {
  return (
    <Layout title={useCase.pageTitle} description={useCase.description}>
      <Hero useCase={useCase} />
      <SectionNav />
      <main>
        <Problems useCase={useCase} />
        {useCase.showcase ? <ShowcaseSection showcase={useCase.showcase} /> : null}
        <Day useCase={useCase} />
        <Gaps useCase={useCase} />
        <Start useCase={useCase} />
        <FaqSection useCase={useCase} />
        <Others slug={useCase.slug} />
      </main>
    </Layout>
  );
}
