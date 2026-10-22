import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { SharedGroupPhotos } from "../../../components/sharing/SharedGroupPhotos";
import { useThingLabel } from "../../../hooks/useThingLabel";

export const Route = createFileRoute("/_protected/sharing/withme/things/$title")({
  component: SharedThingPhotos,
});

/** The photos shared with you that show one thing (#2721). */
function SharedThingPhotos() {
  const { title } = Route.useParams();
  const thingLabel = useThingLabel();
  return <SharedGroupPhotos group={{ kind: "things", title }} title={thingLabel(title)} />;
}
