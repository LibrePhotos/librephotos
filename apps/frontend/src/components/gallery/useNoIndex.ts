import { useEffect } from "react";

/**
 * Asks search engines not to index the page while `noIndex` is set: a `robots` meta tag in the
 * document head, removed again when the page goes away or the admin lets them in (#434).
 */
export function useNoIndex(noIndex: boolean) {
  useEffect(() => {
    if (!noIndex) return undefined;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [noIndex]);
}
