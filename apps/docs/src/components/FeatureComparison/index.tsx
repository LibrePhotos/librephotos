import React, { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import data from "@site/src/data/feature-comparison.json";
import {
  STATUS_LABEL,
  defaultFilters,
  filtersFromQuery,
  filtersToQuery,
  mustHaveScore,
  visibleFeatures,
  visibleProducts,
  type Cell,
  type Comparison,
  type Filters,
  type ProductKind,
  type Status,
} from "@site/src/data/featureComparison";
import styles from "./styles.module.css";

const COMPARISON: Comparison = data as Comparison;

const STATUS_ICON: Record<Status, string> = {
  yes: "✓",
  partial: "◐",
  plugin: "+",
  paid: "$",
  planned: "…",
  no: "✕",
  na: "–",
  unknown: "?",
};

const LEGEND: { status: Status; text: string }[] = [
  { status: "yes", text: "Built in" },
  { status: "partial", text: "With a limitation (hover or turn on notes)" },
  { status: "plugin", text: "Through a plugin or add-on" },
  { status: "paid", text: "Only in a paid tier" },
  { status: "planned", text: "Planned or in progress" },
  { status: "no", text: "Not available" },
  { status: "na", text: "Does not apply" },
  { status: "unknown", text: "Not known yet" },
];

const KIND_LABEL: Record<ProductKind, string> = {
  server: "Self-hosted",
  desktop: "Desktop",
  saas: "Cloud service",
};

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function CellView({ cell, showNotes }: { cell: Cell | undefined; showNotes: boolean }): ReactNode {
  const status: Status | undefined = cell?.s ?? (cell?.v ? undefined : "unknown");
  const title = [status ? STATUS_LABEL[status] : null, cell?.v, cell?.n].filter(Boolean).join(": ");
  return (
    <td className={clsx(styles.cell, status && styles[`s_${status}`])} title={title}>
      {status && (
        <span className={styles.badge}>
          <span aria-hidden="true">{STATUS_ICON[status]}</span>
          <span className={styles.visuallyHidden}>{STATUS_LABEL[status]}</span>
        </span>
      )}
      {cell?.v && <span className={styles.value}>{cell.v}</span>}
      {cell?.n && !showNotes && (
        <sup className={styles.noteMark} aria-hidden="true">
          i
        </sup>
      )}
      {cell?.n && <span className={clsx(styles.note, !showNotes && styles.visuallyHidden)}>{cell.n}</span>}
    </td>
  );
}

function Chip({
  active,
  dimmed = false,
  onClick,
  children,
  title,
}: {
  active: boolean;
  dimmed?: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx(styles.chip, active && styles.chipActive, dimmed && styles.chipDimmed)}
      aria-pressed={active}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

/**
 * The feature comparison table with its filters. The filters live in the query string, so a
 * filtered view can be shared as a link; the server renders the unfiltered table.
 */
export default function FeatureComparison(): ReactNode {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(COMPARISON));
  const [showNotes, setShowNotes] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFilters(filtersFromQuery(COMPARISON, window.location.search));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const url = `${window.location.pathname}${filtersToQuery(COMPARISON, filters)}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filters, ready]);

  const products = useMemo(() => visibleProducts(COMPARISON, filters), [filters]);
  const shownIds = new Set(products.map((p) => p.id));
  const allIds = COMPARISON.products.map((p) => p.id);
  const features = useMemo(() => visibleFeatures(COMPARISON, filters), [filters]);
  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const isDefault = filtersToQuery(COMPARISON, filters) === "";

  const presets: { label: string; ids: string[] }[] = [
    { label: "All", ids: COMPARISON.products.map((p) => p.id) },
    { label: "Self-hosted", ids: COMPARISON.products.filter((p) => p.kind === "server").map((p) => p.id) },
    { label: "Open source", ids: COMPARISON.products.filter((p) => p.openSource).map((p) => p.id) },
  ];

  const mustHaveCount = filters.mustHave.length;

  return (
    <div className={styles.root}>
      <div className={styles.controls} role="search" aria-label="Filter the comparison">
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search features, e.g. faces, XMP, OIDC"
            aria-label="Search features"
            value={filters.text}
            onChange={(e) => update({ text: e.target.value })}
          />
          <label className={styles.switch}>
            <input type="checkbox" checked={filters.onlyDifferences} onChange={(e) => update({ onlyDifferences: e.target.checked })} />
            Only rows where the apps differ
          </label>
          <label className={styles.switch}>
            <input type="checkbox" checked={showNotes} onChange={(e) => setShowNotes(e.target.checked)} />
            Show notes
          </label>
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>Categories</span>
          <Chip active={filters.categories.length === 0} onClick={() => update({ categories: [] })}>
            All
          </Chip>
          {COMPARISON.categories.map((c) => (
            <Chip key={c.id} active={filters.categories.includes(c.id)} onClick={() => update({ categories: toggle(filters.categories, c.id) })}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>Apps</span>
          {presets.map((p) => (
            <Chip
              key={p.label}
              active={p.ids.length === filters.products.length && p.ids.every((id) => filters.products.includes(id))}
              onClick={() => update({ products: p.ids })}
            >
              {p.label}
            </Chip>
          ))}
          <span className={styles.divider} aria-hidden="true" />
          {COMPARISON.products.map((p) => {
            const chosen = filters.products.includes(p.id);
            const missing = chosen && !shownIds.has(p.id);
            return (
              <Chip
                key={p.id}
                active={chosen}
                dimmed={missing}
                title={
                  missing
                    ? `${p.name} misses a must-have`
                    : `${KIND_LABEL[p.kind]}, ${p.openSource ? "open source" : "proprietary"}`
                }
                onClick={() => update({ products: allIds.filter((id) => (id === p.id ? !chosen : filters.products.includes(id))) })}
              >
                {p.name}
              </Chip>
            );
          })}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>Must-haves</span>
          {mustHaveCount === 0 ? (
            <span className={styles.hint}>Tick ☆ next to the features you need to see which apps have all of them.</span>
          ) : (
            <>
              {COMPARISON.features
                .filter((f) => filters.mustHave.includes(f.id))
                .map((f) => (
                  <Chip key={f.id} active onClick={() => update({ mustHave: toggle(filters.mustHave, f.id) })} title="Remove">
                    {f.name} ✕
                  </Chip>
                ))}
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={filters.hideMissingMustHave}
                  onChange={(e) => update({ hideMissingMustHave: e.target.checked })}
                />
                Hide apps missing one
              </label>
            </>
          )}
        </div>

        <div className={styles.summary} aria-live="polite">
          <span>
            {features.length} of {COMPARISON.features.length} features, {products.length} of {COMPARISON.products.length} apps
          </span>
          {!isDefault && (
            <button type="button" className={styles.reset} onClick={() => setFilters(defaultFilters(COMPARISON))}>
              Reset filters
            </button>
          )}
        </div>
      </div>

      <div className={styles.scroller} tabIndex={0} role="region" aria-label="Feature comparison table">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                Feature
              </th>
              {products.map((p) => (
                <th key={p.id} scope="col" className={clsx(styles.productHead, p.id === "librephotos" && styles.ours)}>
                  <a href={p.url} title={`Checked: ${p.checked}`}>
                    {p.name}
                  </a>
                  <span className={styles.kind}>{KIND_LABEL[p.kind]}</span>
                  {mustHaveCount > 0 && (
                    <span
                      className={clsx(styles.score, mustHaveScore(COMPARISON, filters.mustHave, p.id) === mustHaveCount && styles.scoreFull)}
                    >
                      {mustHaveScore(COMPARISON, filters.mustHave, p.id)}/{mustHaveCount}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.categories.map((category) => {
              const rows = features.filter((f) => f.category === category.id);
              if (rows.length === 0) return null;
              return (
                <Fragment key={category.id}>
                  <tr className={styles.categoryRow}>
                    <th scope="colgroup" colSpan={products.length + 1}>
                      <span className={styles.categoryLabel}>{category.label}</span>
                    </th>
                  </tr>
                  {rows.map((f) => {
                    const needed = filters.mustHave.includes(f.id);
                    return (
                      <tr key={f.id} id={`feature-${f.id}`} className={clsx(needed && styles.neededRow)}>
                        <th scope="row" className={styles.featureHead}>
                          <div className={styles.featureHeadInner}>
                          <button
                            type="button"
                            className={clsx(styles.star, needed && styles.starOn)}
                            aria-pressed={needed}
                            aria-label={needed ? `Remove ${f.name} from must-haves` : `Add ${f.name} to must-haves`}
                            onClick={() => update({ mustHave: toggle(filters.mustHave, f.id) })}
                          >
                            {needed ? "★" : "☆"}
                          </button>
                          <span>
                            <span className={styles.featureName}>{f.name}</span>
                            {f.hint && <span className={styles.featureHint}>{f.hint}</span>}
                          </span>
                          </div>
                        </th>
                        {products.map((p) => (
                          <CellView key={p.id} cell={f.cells[p.id]} showNotes={showNotes} />
                        ))}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {features.length === 0 && (
              <tr>
                <td colSpan={products.length + 1} className={styles.empty}>
                  No feature matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className={styles.legend} aria-label="Legend">
        {LEGEND.map((l) => (
          <li key={l.status} className={styles[`s_${l.status}`]}>
            <span className={styles.badge} aria-hidden="true">
              {STATUS_ICON[l.status]}
            </span>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
