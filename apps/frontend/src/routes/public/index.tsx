import { createFileRoute } from "@tanstack/react-router";
import React from "react";
import { GalleryPage } from "../../components/gallery/GalleryPage";
import { validateGallerySearch } from "../../components/gallery/gallerySearch";

// The public gallery (#434): the public photos of every user who takes part. While the admin keeps
// it closed this sends the visitor on, as /public did before: the timeline, or the login page.
export const Route = createFileRoute("/public/")({
  component: PublicGallery,
  validateSearch: validateGallerySearch,
});

function PublicGallery() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <GalleryPage search={search} onSearch={next => void navigate({ search: next })} />;
}
