import { ApiError } from "@librephotos/api-client";
import { Anchor } from "@mantine/core";
import { IconMap as Map, IconTags as Tags, IconUser as User } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SharedGroupRef } from "../../api_client/photos/hooks";
import { useFetchSharedGroupPhotosQuery } from "../../api_client/photos/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useListFailure } from "../common/useListFailure";
import { PageHeader } from "../PageHeader";
import { PhotoListView } from "../photolist/PhotoListView";
import { sharerPhotoGroups } from "./sharerGroups";

type Props = Readonly<{
  group: SharedGroupRef;
  /** The page's title: the place, thing or person as the list names it. */
  title: string;
}>;

const ICONS = { places: Map, things: Tags, people: User } as const;

/**
 * The photos shared with you under one place, thing or person of Sharing > Shared with you
 * (#2721, #2722), grouped per owner like the Photos tab. Read only, like the rest of the page.
 */
export function SharedGroupPhotos({ group, title }: Props) {
  const { t } = useTranslation();
  const query = useFetchSharedGroupPhotosQuery(group);
  const { data: photos, isLoading, error } = query;
  const { data: users } = useFetchUserListQuery();
  const photoset = useMemo(
    () =>
      sharerPhotoGroups(photos ?? [], users, {
        fallbackName: userId => `user(${userId})`,
        countLabel: count => t("sharing.sharedPhotosWithYou", { count }),
      }),
    [photos, users, t]
  );
  const idx2hash = useMemo(() => (photos ?? []).flatMap(owner => owner.photos), [photos]);
  // A 404: nothing is shared under it any more (unshared, or a stale link). Any other failure
  // offers a retry.
  const notFound = error instanceof ApiError && error.status === 404;
  const listFailure = useListFailure(query);
  const Icon = ICONS[group.kind];

  return (
    <>
      <PageHeader
        icon={Icon}
        title={title}
        loading={isLoading}
        subtitle={
          <Anchor
            size="sm"
            renderRoot={rootProps => <Link {...rootProps} to="/sharing/withme/$tab" params={{ tab: group.kind }} />}
          >
            {t("sharing.backToSharedWithYou")}
          </Anchor>
        }
      />
      <PhotoListView
        title={title}
        loading={isLoading}
        icon={Icon}
        photoset={photoset}
        idx2hash={idx2hash}
        isPublic
        selectable={false}
        // Under this page's own header: each group names whose photos they are
        header={null}
        error={notFound ? undefined : listFailure}
        emptyStateConfig={
          notFound
            ? {
                icon: <Icon size={40} />,
                title: t("sharing.sharedGroupGoneTitle"),
                description: t("sharing.sharedGroupGoneDescription"),
                actionLabel: t("sharing.backToSharedWithYou"),
                actionLink: `/sharing/withme/${group.kind}/`,
              }
            : undefined
        }
      />
    </>
  );
}
