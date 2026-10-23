import { IconUsers } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { GalleryLinkCard } from "../../../components/gallery/GalleryLinkCard";
import { LibrariesSharedWithYouSection } from "../../../components/libraryShare/LibrariesSharedWithYouSection";
import { YourLibrarySection } from "../../../components/libraryShare/YourLibrarySection";
import { PageBody } from "../../../components/PageBody";
import { PageHeader } from "../../../components/PageHeader";
import { PublicLinksSection } from "../../../components/sharing/PublicLinksSection";
import {
  PublicUsersSection,
  SharedWithYouSection,
  YouSharedSection,
} from "../../../components/sharing/SharingOverviewSections";

export const Route = createFileRoute("/_protected/sharing/")({
  component: SharingExplore,
});

/** The Sharing overview: a preview of each sharing page, each linking to it. */
function SharingExplore() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader icon={IconUsers} title={t("sidemenu.sharing")} subtitle={t("sharing.subtitle")} />
      <PageBody gap="md">
        <YourLibrarySection />
        <LibrariesSharedWithYouSection />
        <GalleryLinkCard />
        <PublicUsersSection />
        <SharedWithYouSection />
        <YouSharedSection />
        <PublicLinksSection />
      </PageBody>
    </>
  );
}
