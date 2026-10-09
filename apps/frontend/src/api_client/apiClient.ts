export const serverAddress: string = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";
// This is used for sharing. URL handling needs to account for subdirectory.
// The origin, not the host: a copied link without its scheme is not a link.
export const shareAddress: string =
  window.location.origin + (import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "");
