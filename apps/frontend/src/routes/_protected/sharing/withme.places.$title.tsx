import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { SharedGroupPhotos } from "../../../components/sharing/SharedGroupPhotos";

export const Route = createFileRoute("/_protected/sharing/withme/places/$title")({
  component: SharedPlacePhotos,
});

/** The photos shared with you from one place (#2721). */
function SharedPlacePhotos() {
  const { title } = Route.useParams();
  return <SharedGroupPhotos group={{ kind: "places", title }} title={title} />;
}
