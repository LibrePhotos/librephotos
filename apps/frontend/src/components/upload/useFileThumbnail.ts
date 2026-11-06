import { useEffect, useState } from "react";

/**
 * An object URL for a picked image file, to show it as its own thumbnail while it uploads; revoked
 * when the row goes away. Undefined for a video, or where the browser has no object URLs (jsdom).
 */
export function useFileThumbnail(file: File): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [file]);
  return url;
}
