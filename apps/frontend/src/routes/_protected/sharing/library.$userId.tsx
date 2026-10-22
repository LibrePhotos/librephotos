import { IconLibraryPhoto } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { PageLoader } from "../../../components/common/PageLoader";
import { personName } from "../../../components/libraryShare/libraryShareFields";
import {
  LibraryMenu,
  LibraryNotShared,
  LibrarySubHeader,
  ReadOnlyBadge,
} from "../../../components/libraryShare/SharedLibraryParts";
import { useSharedLibrary } from "../../../components/libraryShare/useSharedLibrary";
import { PhotoListView } from "../../../components/photolist/PhotoListView";
import { validatePhotoSearch } from "../../../components/photolist/photoSearch";

export const Route = createFileRoute("/_protected/sharing/library/$userId")({
  component: SharedLibrary,
  // ?photo= is the photo open in the lightbox.
  validateSearch: validatePhotoSearch,
});

/**
 * A library someone shares with me, read-only (#2731): their days, without what they do not
 * share; my timeline switch and what they share under the title; Leave in the menu.
 */
function SharedLibrary() {
  const { t } = useTranslation();
  const { userId } = Route.useParams();
  const library = useSharedLibrary(Number(userId));
  const { share } = library;
  if (library.loadingShares) return <PageLoader />;
  if (!share) return <LibraryNotShared />;
  const name = personName(share.owner);
  return (
    <PhotoListView
      title={t("librarySharing.libraryOf", { name })}
      loading={library.loadingPhotos}
      icon={IconLibraryPhoto}
      photoset={library.groups}
      idx2hash={library.photosFlat}
      updateGroups={library.updateGroups}
      selectable={false}
      isPublic
      titleBadge={<ReadOnlyBadge />}
      additionalSubHeader={<LibrarySubHeader share={share} />}
      headerActions={<LibraryMenu share={share} />}
      emptyStateConfig={{ title: t("librarySharing.emptyLibrary", { name }), description: "" }}
      error={library.failure}
    />
  );
}
