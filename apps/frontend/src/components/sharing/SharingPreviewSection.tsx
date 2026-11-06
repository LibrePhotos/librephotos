import { IconChevronRight } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import overviewClasses from "./SharingOverview.module.css";
import { SharePreviewSkeleton } from "./SharingPreviewCards";
import { SharingRow } from "./SharingRow";

/** What "View all" wraps: spread on a router Link to the section's page. */
type HeadingLinkProps = Readonly<{ className: string | undefined; children: ReactNode }>;

type Props = Readonly<{
  /** The section's 24px icon. */
  icon: ReactNode;
  title: string;
  /** "N photos, M albums", under the title. */
  summary: string;
  /** The "View all" link to the section's page. */
  renderLink: (props: HeadingLinkProps) => ReactNode;
  loading: boolean;
  /** Says there is nothing in the section; null when there is. */
  emptyText: string | null;
  /** The placeholder while loading; a row of cards by default. */
  skeleton?: ReactNode;
  children: ReactNode;
}>;

/**
 * One section of the Sharing overview (SharingRow): its icon, title and "N photos, M albums", a
 * "View all ›" to its page on the right, and the preview under it. With nothing in it the section
 * is the row alone, its line saying so, without the "View all" into an empty page.
 */
export function SharingPreviewSection({
  icon,
  title,
  summary,
  renderLink,
  loading,
  emptyText,
  skeleton,
  children,
}: Props) {
  const { t } = useTranslation();
  if (!loading && emptyText !== null) {
    return <SharingRow icon={icon} title={title} description={emptyText} />;
  }
  return (
    <SharingRow
      icon={icon}
      title={title}
      description={loading ? "" : summary}
      action={renderLink({
        className: overviewClasses.viewAll,
        children: (
          <>
            {t("explore.viewAll")}
            <IconChevronRight size={14} aria-hidden />
          </>
        ),
      })}
    >
      {loading ? (skeleton ?? <SharePreviewSkeleton />) : children}
    </SharingRow>
  );
}

/** "1 photo, 2 albums": each count is pluralised on its own. */
export function itemSummary(t: TFunction, photos: number, albums: number): string {
  return t("sharing.itemSummary", {
    photos: t("sharing.photoCount", { count: photos }),
    albums: t("explore.albumCount", { count: albums }),
  });
}
