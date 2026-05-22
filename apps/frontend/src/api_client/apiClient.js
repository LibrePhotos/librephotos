export const serverAddress = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";
// This is used for sharing. URL handling needs to account for subdirectory.
export const shareAddress = window.location.host + (import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "");
