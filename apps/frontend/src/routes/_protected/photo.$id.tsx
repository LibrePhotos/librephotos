import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { PhotoPage } from "../../components/photopage/PhotoPage";

export const Route = createFileRoute("/_protected/photo/$id")({
  component: SinglePhotoView,
});

function SinglePhotoView() {
  const { id } = Route.useParams();
  return <PhotoPage photoId={id} />;
}
