import { IconFaceId } from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../common/EmptyState";
import type { FacesTabLists } from "./facesCounters";
import { FacesTab } from "./facesTab";

type Props = Readonly<{
  activeTab: FacesTab;
  lists: FacesTabLists;
  /** Whether any people list is still loading. */
  fetching: boolean;
}>;

const routeApi = getRouteApi("/_protected/faces");

/**
 * The face dashboard without faces in the active tab. "Scan your photos" only fits when no tab has
 * any face. Otherwise only this tab is empty (e.g. every face is labeled), so it offers the tab that
 * has faces instead.
 */
export function FacesEmptyState({ activeTab, lists, fetching }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = routeApi.useSearch();
  const noFacesAtAll = !fetching && FacesTab.options.every(tab => lists[tab].length === 0);
  if (noFacesAtAll) {
    return (
      <EmptyState
        icon={<IconFaceId size={40} />}
        title={t("emptystate.faces.title")}
        description={t("emptystate.faces.description")}
        actionLabel={t("emptystate.goToLibrary")}
        actionLink="/library"
      />
    );
  }
  const otherTab = FacesTab.options.find(tab => tab !== activeTab && lists[tab].length > 0);
  return (
    <EmptyState
      icon={<IconFaceId size={40} />}
      title={t(`emptystate.facesTab.${activeTab}.title`)}
      description={t(`emptystate.facesTab.${activeTab}.description`)}
      actionLabel={otherTab && t(`emptystate.facesTab.show.${otherTab}`)}
      onAction={otherTab && (() => void navigate({ to: "/faces", search: { ...search, tab: otherTab } }))}
    />
  );
}
