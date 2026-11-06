import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { GalleryLinkCard } from "../../../components/gallery/GalleryLinkCard";
import { LibrariesSharedWithYouSection } from "../../../components/libraryShare/LibrariesSharedWithYouSection";
import { YourLibrarySection } from "../../../components/libraryShare/YourLibrarySection";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { PublicLinksSection } from "../../../components/sharing/PublicLinksSection";
import overviewClasses from "../../../components/sharing/SharingOverview.module.css";
import {
  PublicUsersSection,
  SharedWithYouSection,
  YouSharedSection,
} from "../../../components/sharing/SharingOverviewSections";

export const Route = createFileRoute("/_protected/sharing/")({
  component: SharingExplore,
});

/** The Sharing overview: a row per kind of sharing (SharingRow), with a preview of each page linking to it. */
function SharingExplore() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("sidemenu.sharing")} subtitle={t("sharing.subtitle")} />
      {/* One list of rows, a hairline between them, 24px under the header (its 12px and these) */}
      <PageBody gap={0} pt={12}>
        <div className={overviewClasses.list}>
          <YourLibrarySection />
          <LibrariesSharedWithYouSection />
          <GalleryLinkCard />
          <PublicUsersSection />
          <SharedWithYouSection />
          <YouSharedSection />
          <PublicLinksSection />
        </div>
      </PageBody>
    </>
  );
}
