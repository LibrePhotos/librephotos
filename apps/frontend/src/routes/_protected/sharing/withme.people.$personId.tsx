import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchSharedPeopleWithMeQuery } from "../../../api_client/photos/hooks";
import { sharedPersonLabel } from "../../../components/sharing/PeopleSharedWithMe";
import { SharedGroupPhotos } from "../../../components/sharing/SharedGroupPhotos";

export const Route = createFileRoute("/_protected/sharing/withme/people/$personId")({
  component: SharedPersonPhotos,
});

/** The photos shared with you that show one person the owner named (#2722). */
function SharedPersonPhotos() {
  const { t } = useTranslation();
  // Not a number: no person has that id, and the server answers 404 like for any other.
  const personId = Number.parseInt(Route.useParams().personId, 10) || 0;
  const { data: people } = useFetchSharedPeopleWithMeQuery();
  const person = people?.find(entry => entry.id === personId);
  const label = person && sharedPersonLabel(person, owner => t("sharing.sharedBy", { name: owner }));
  const title = label ? t("sharing.sharedPersonTitle", { name: label.name, owner: label.owner }) : t("people");
  return <SharedGroupPhotos group={{ kind: "people", personId }} title={title} />;
}
