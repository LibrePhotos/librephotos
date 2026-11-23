import type { Plugin } from "vite";

const TRANSLATION_CHUNK = /\/locales\/([^/]+)\/translation\.json$/;

export function localesToPreload(
  files: Record<string, string>,
  query: string,
  saved: string | null,
  browser: readonly string[]
): string[] {
  const requested = new URLSearchParams(query).get("lng") || saved || browser[0] || "en";
  const base = requested.split("-")[0]?.toLowerCase() ?? "";
  const wanted = [requested, base, "en"];
  const urls: string[] = [];
  for (const language of wanted) {
    const url = files[language];
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

export function preloadScript(files: Record<string, string>): string {
  return `(function () {
  var saved = null;
  try {
    saved = window.localStorage.getItem("i18nextLng");
  } catch (e) {}
  var browser = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  (${localesToPreload.toString()})(${JSON.stringify(files)}, window.location.search, saved, browser).forEach(function (href) {
    var link = document.createElement("link");
    link.rel = "modulepreload";
    link.crossOrigin = "";
    link.href = href;
    document.head.appendChild(link);
  });
})();`;
}

export function localePreloadPlugin(): Plugin {
  let base = "/";
  return {
    name: "librephotos-locale-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const files: Record<string, string> = {};
        for (const output of Object.values(ctx.bundle ?? {})) {
          const language =
            output.type === "chunk" ? TRANSLATION_CHUNK.exec(output.facadeModuleId ?? "")?.[1] : undefined;
          if (language) {
            files[language] = base + output.fileName;
          }
        }
        if (Object.keys(files).length === 0) {
          return [];
        }
        return [{ tag: "script", children: preloadScript(files), injectTo: "head" }];
      },
    },
  };
}
