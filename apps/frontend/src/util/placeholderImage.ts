// Fallback image for thumbnails that fail to load. Inlined as an SVG data URI
// so a self-hosted instance makes no request to a third-party placeholder
// service, and so it works regardless of the base path the app is served at.
// Mid-grey on a translucent tile reads in both the light and dark theme; the
// viewBox keeps it crisp at any size.
const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="#868e96" fill-opacity="0.15"/>' +
  '<g fill="none" stroke="#868e96" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="30" y="34" width="40" height="32" rx="3"/>' +
  '<circle cx="42" cy="45" r="4"/>' +
  '<path d="M30 60l12-10 10 8 6-5 12 10"/>' +
  "</g></svg>";

export const PLACEHOLDER_IMAGE = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`;
