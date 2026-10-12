// @vitest-environment node
// Plants one violation per convention ban (eslint.config.mjs) and lints it, through the real config,
// at a file of every scope the bans name: each ban must fire where it applies and stay quiet in its
// `allowIn` files, whatever the other bans and blocks do.
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import config, {
  globalBans,
  importBans,
  propertyBans,
  SIZE_BASELINE_PATH,
  SIZE_FILES,
  SIZE_IGNORES,
  SIZE_LIMITS,
  sizeBaseline,
  syntaxBans,
} from "./eslint.config.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const TS_FILES = ["**/*.{ts,tsx}"];
const bans = [...importBans, ...syntaxBans, ...globalBans, ...propertyBans];

// One violation per ban id. A new ban without an entry here fails the first test.
const planted = {
  "mantine-modals": `import { modals } from "@mantine/modals";`,
  lodash: `import { debounce } from "lodash";`,
  dayjs: `import dayjs from "dayjs";`,
  "mantine-notifications": `import { notifications } from "@mantine/notifications";`,
  "react-cookie": `import { useCookies } from "react-cookie";`,
  "react-pig": `import { Pig } from "../react-pig";`,
  "react-virtual": `import { useVirtualizer } from "@tanstack/react-virtual";`,
  "virtual-grid": `import { VirtualGrid } from "../virtual/VirtualGrid";`,
  "query-client-singleton": `import { queryClient } from "../../api_client/api";`,
  "api-client-import": `import { apiClient } from "../../api_client/api";`,
  "api-client-zod": `import { z } from "zod";`,
  "api-client-zod-utils": `import { parseWithNotification } from "../../../util/zodUtils";`,
  "api-client-method": `const plantedRequest = apiClient.get("/photos/");`,
  "media-url": "const plantedMedia = `${serverAddress}/media/photos/${hash}`;",
  "tile-index": `const plantedIndex = rowIndex * columns + columnIndex;`,
  "query-key-literal": `const plantedQuery = { queryKey: ["photoDetails", hash] };`,
  "untyped-mock": `const plantedMock = vi.fn();`,
  "open-state": `const [modalOpen, setModalOpen] = useState(false);`,
  "route-modal": `const plantedDialog = <Modal opened onClose={close} />;`,
  "date-parse": `const plantedInstant = DateTime.fromISO(value);`,
  "date-set-locale": `const plantedLabel = plantedInstant.setLocale("de").toFormat("D");`,
  "date-constructor": `const plantedDate = new Date(value);`,
  "poll-interval": `const plantedQuery = { refetchInterval: 2000 };`,
  "api-client-timer": `setTimeout(refresh, 1000);`,
  "page-loader-returned": `function PlantedPage() { return <Loader />; }`,
  "page-loader-wrapped": `const plantedLoading = <Center><Loader /></Center>;`,
  "error-boundary": `class PlantedBoundary { componentDidCatch() {} }`,
  "t-default": `const plantedDefault = t("sidemenu.photos", "Photos");`,
  "t-default-value": `const plantedDefaultValue = t("sidemenu.photos", { defaultValue: "Photos" });`,
  "trans-children": `const plantedTrans = <Trans i18nKey="sidemenu.photos">Photos</Trans>;`,
  "form-validate-object": `const plantedForm = useForm({ validate: { email: value => (value ? null : "required") } });`,
  "local-storage": `const plantedLocal = localStorage.getItem("key");`,
  "session-storage": `const plantedSession = sessionStorage.getItem("key");`,
  "custom-event": `const plantedEvent = new CustomEvent("planted");`,
  fetch: `const plantedFetch = fetch("/api/photos/");`,
  "window-local-storage": `const plantedWindowLocal = window.localStorage;`,
  "window-session-storage": `const plantedWindowSession = window.sessionStorage;`,
  "globalthis-local-storage": `const plantedGlobalLocal = globalThis.localStorage;`,
  "globalthis-session-storage": `const plantedGlobalSession = globalThis.sessionStorage;`,
  "window-fetch": `const plantedWindowFetch = window.fetch("/api/photos/");`,
  "globalthis-fetch": `const plantedGlobalFetch = globalThis.fetch("/api/photos/");`,
  "window-dispatch-event": `window.dispatchEvent(new Event("resize"));`,
  "style-from-handler": `event.currentTarget.style.opacity = "1";`,
};
const isJsx = code => /<[A-Z]/.test(code);

/** `{a,b}` alternatives of a glob, one glob each. */
function expandBraces(glob) {
  const match = /\{([^{}]*)\}/.exec(glob);
  if (!match) return [glob];
  return match[1]
    .split(",")
    .flatMap(choice => expandBraces(glob.slice(0, match.index) + choice + glob.slice(match.index + match[0].length)));
}

/** A concrete file a glob matches: `**` and `*` become a directory or file name. */
function sampleFor(glob) {
  return glob
    .replace(/^\*\*\//, "src/")
    .replace(/\*\*$/, "sample.tsx")
    .replace(/\*\*/g, "sample")
    .replace(/\*/g, "sample");
}

// Plain app, test and e2e files, plus a file inside every glob a ban names (its scope and its
// exemptions), as .ts and .tsx.
const samplePaths = [
  ...new Set([
    "src/components/Sample.tsx",
    "src/components/sample.ts",
    "src/components/Sample.test.tsx",
    "e2e/tests/sample.spec.ts",
    ...bans.flatMap(ban => [...(ban.files ?? []), ...(ban.allowIn ?? [])].flatMap(expandBraces).map(sampleFor)),
  ]),
];

const matches = (file, globs) => globs.flatMap(expandBraces).some(glob => path.posix.matchesGlob(file, glob));
const applies = (ban, file) => matches(file, ban.files ?? TS_FILES) && !matches(file, ban.allowIn ?? []);

// The real config, without type information (the planted files do not exist) and with only the
// ban rules running.
const eslint = new ESLint({
  cwd,
  overrideConfig: { languageOptions: { parserOptions: { project: null } } },
  ruleFilter: ({ ruleId }) => ruleId.startsWith("ban/"),
});

async function firedBans(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath: path.join(cwd, filePath) });
  const fatal = result.messages.filter(message => message.fatal);
  expect(fatal, `${filePath} must parse`).toEqual([]);
  return new Set(result.messages.map(message => message.ruleId));
}

describe("eslint.config.mjs convention bans", () => {
  it("has a planted violation for every ban, and no rule-setting outside the ban blocks", () => {
    expect(Object.keys(planted).sort()).toEqual(bans.map(ban => ban.id).sort());

    const restricted = /^(@typescript-eslint\/)?no-restricted-(imports|syntax|globals|properties)$/;
    for (const block of config) {
      const ruleIds = Object.keys(block.rules ?? {});
      if (block.name?.startsWith("ban/")) {
        expect(ruleIds).toEqual(block.name === "ban/plugin" ? [] : [block.name]);
      } else {
        expect(
          ruleIds.filter(id => restricted.test(id) || id.startsWith("ban/")),
          JSON.stringify(block.files)
        ).toEqual([]);
      }
    }
  });

  it.each(bans.map(ban => [ban.id, ban]))("%s fires on its planted violation", async (id, ban) => {
    const file = samplePaths.find(sample => applies(ban, sample) && (!isJsx(planted[id]) || sample.endsWith(".tsx")));
    expect(file, `a sample file in the scope of ${id}`).toBeDefined();
    expect(await firedBans(planted[id], file)).toContain(`ban/${id}`);
  });

  it.each(samplePaths)("%s gets exactly the bans whose scope covers it", async file => {
    const code = Object.values(planted)
      .filter(snippet => file.endsWith(".tsx") || !isJsx(snippet))
      .join("\n");
    const fired = await firedBans(code, file);
    const expected = bans
      .filter(ban => applies(ban, file) && (file.endsWith(".tsx") || !isJsx(planted[ban.id])))
      .map(ban => `ban/${ban.id}`);
    expect([...fired].sort()).toEqual(expected.sort());
  });

  // The documented exemptions, spelled out, so a typo in a glob shows here.
  it.each([
    ["src/util/storage.ts", "local-storage", false],
    ["src/util/storage.ts", "custom-event", true],
    ["src/util/storage.ts", "untyped-mock", true],
    ["src/util/storage.test.ts", "window-local-storage", false],
    ["src/util/storage.test.ts", "window-dispatch-event", false],
    ["src/components/Sample.tsx", "window-dispatch-event", true],
    ["src/api_client/polling.ts", "api-client-timer", true],
    ["src/api_client/polling.ts", "untyped-mock", true],
    ["src/api_client/photos/usePhotos.ts", "api-client-timer", true],
    ["src/api_client/photos/usePhotos.test.ts", "api-client-timer", false],
    ["src/components/sample.ts", "api-client-timer", false],
    ["src/routes/_protected/sample.tsx", "route-modal", true],
    ["src/components/modals/SampleModal.tsx", "route-modal", false],
    ["src/App.tsx", "mantine-notifications", false],
    ["src/service/notifications/toast.ts", "mantine-notifications", false],
    ["src/api_client/authCookies.ts", "react-cookie", false],
    ["src/util/dateUtils.ts", "date-parse", false],
    ["src/components/common/PageLoader.tsx", "page-loader-returned", false],
    ["src/components/common/FeatureBoundary.tsx", "error-boundary", false],
    ["src/components/photolist/PhotoListView.tsx", "react-pig", false],
    ["src/components/photolist/PhotoListView.tsx", "react-virtual", true],
    ["src/components/virtual/TileGrid.tsx", "react-virtual", false],
    ["src/components/virtual/TileGrid.tsx", "tile-index", false],
    ["src/components/virtual/TileGrid.tsx", "react-pig", true],
    ["src/components/facedashboard/FaceGrid.tsx", "virtual-grid", false],
    ["src/components/facedashboard/FaceGrid.tsx", "react-virtual", true],
    ["src/components/album/AlbumGrid.tsx", "tile-index", true],
    ["src/routes/signup.tsx", "form-validate-object", true],
    ["src/components/modals/ModalUserEdit.test.tsx", "form-validate-object", true],
    ["src/api_client/api.ts", "query-client-singleton", false],
    ["src/index.tsx", "query-client-singleton", false],
    ["src/api_client/photos/hooks/useSample.ts", "query-client-singleton", true],
    ["src/components/sample.ts", "query-key-literal", true],
    ["src/api_client/photos/keys.ts", "query-key-literal", true],
    ["src/index.tsx", "api-client-import", false],
    ["src/api_client/photos/hooks/useSample.ts", "api-client-import", false],
    ["src/components/settings/Library.tsx", "api-client-import", true],
    ["src/routes/public/s.$slug.tsx", "api-client-import", true],
    ["src/hooks/useSample.ts", "api-client-import", true],
    ["src/api_client/api.ts", "api-client-method", false],
    ["src/api_client/api.test.ts", "api-client-method", false],
    ["src/api_client/photos/hooks/useSample.ts", "api-client-method", true],
    ["src/components/Sample.tsx", "api-client-method", true],
    ["src/api_client/photos/types.ts", "api-client-zod", true],
    ["src/api_client/photos/types.test.ts", "api-client-zod", true],
    ["src/components/settings/Sample.schema.ts", "api-client-zod", false],
    ["src/util/formSchemas.ts", "api-client-zod", false],
    ["src/api_client/photos/hooks/useSample.ts", "api-client-zod-utils", true],
    ["src/components/Sample.tsx", "api-client-zod-utils", false],
    ["src/api_client/api.ts", "fetch", false],
    ["src/api_client/media/mediaUrl.ts", "fetch", false],
    ["src/api_client/media/mediaUrl.ts", "window-fetch", false],
    ["src/util/dataUrl.ts", "fetch", false],
    ["src/util/imageClipboard.ts", "fetch", true],
    ["src/components/lightbox/VideoPlayer.tsx", "window-fetch", true],
    ["src/api_client/jobs/hooks/useDownloadPhotosMutation.ts", "fetch", true],
    ["src/components/lightbox/VideoPlayer.test.tsx", "fetch", false],
    ["src/api_client/media/mediaUrl.ts", "media-url", false],
    ["src/api_client/media/hooks/useMediaDiagnosticsQuery.ts", "media-url", false],
    ["src/api_client/jobs/hooks/useDownloadPhotosMutation.ts", "media-url", true],
    ["src/components/Tile.tsx", "media-url", true],
    ["src/components/LocationMap.test.tsx", "media-url", false],
    ["e2e/tests/pages.ts", "media-url", false],
  ])("%s: ban/%s fires = %s", async (file, id, fires) => {
    const fired = await firedBans(planted[id], file);
    expect(fired.has(`ban/${id}`)).toBe(fires);
  });

  // The client by any relative path, and the other ways to fetch or spell a media path.
  it.each([
    ["src/components/Sample.tsx", `import { apiClient } from "../api_client/api";`, "api-client-import"],
    ["src/routes/_protected/sample.tsx", `import { apiClient } from "../../api_client/api";`, "api-client-import"],
    [
      "src/components/settings/sample.ts",
      `import { ApiError, apiClient } from "../../api_client/api";`,
      "api-client-import",
    ],
    ["src/api_client/photos/hooks/useSample.ts", `const { post } = apiClient;`, "api-client-method"],
    [
      "src/api_client/photos/hooks/useSample.ts",
      `apiClient.request("/photos/", { method: "PUT" });`,
      "api-client-method",
    ],
    ["src/api_client/photos/types.ts", `import type { ZodType } from "zod";`, "api-client-zod"],
    [
      "src/api_client/settings/hooks/useSample.ts",
      `import { parseListWithNotification } from "../../../util/zodUtils";`,
      "api-client-zod-utils",
    ],
    ["src/components/Sample.tsx", `const plantedImg = <img src="/media/thumbnails_big/abc" />;`, "media-url"],
    ["src/components/sample.ts", `const plantedUrl = serverAddress + "/media/faces/" + name;`, "media-url"],
  ])("%s: %s fires ban/%s", async (file, code, id) => {
    expect(await firedBans(code, file)).toContain(`ban/${id}`);
  });

  it("leaves the error class, server-provided paths and the media module's own path alone", async () => {
    const code = `import { ApiError } from "../api_client/api";
import { mediaUrl } from "../api_client/media/mediaUrl";
export { probeMedia } from "../api_client/media/mediaUrl";
const plantedAvatar = serverAddress + user.avatar_url;
const plantedModule = await import("../api_client/media/mediaUrl");`;
    expect(await firedBans(code, "src/components/Sample.tsx")).toEqual(new Set());
  });
});

// The React Query rules (exhaustive-deps from @tanstack/eslint-plugin-query, and the key-literal and
// singleton bans) on the shapes this app uses: keys from a factory call, the singleton by any path.
describe("eslint.config.mjs React Query rules", () => {
  const queryLint = new ESLint({
    cwd,
    overrideConfig: { languageOptions: { parserOptions: { project: null } } },
    ruleFilter: ({ ruleId }) => ruleId.startsWith("@tanstack/query/") || ruleId.startsWith("ban/query-"),
  });
  const lint = async code => {
    const [result] = await queryLint.lintText(
      `import { useQuery } from "@tanstack/react-query";
import { photoKeys } from "../keys";
${code}`,
      { filePath: path.join(cwd, "src/api_client/photos/hooks/useSample.ts") }
    );
    return result.messages.map(message => message.ruleId);
  };

  it("reports a queryFn value missing from a factory-built key", async () => {
    const code = `export const useSample = (hash: string, size: number) =>
  useQuery({ queryKey: photoKeys.detail(hash), queryFn: () => fetchPhoto(hash, size) });`;
    expect(await lint(code)).toContain("@tanstack/query/exhaustive-deps");
  });

  it("accepts a factory-built key that holds every value the queryFn reads", async () => {
    const code = `export const useSample = (hash: string) =>
  useQuery({ queryKey: photoKeys.detail(hash), queryFn: () => fetchPhoto(hash) });`;
    expect(await lint(code)).toEqual([]);
  });

  it("reports a literal key, in a query and in a cache read", async () => {
    expect(await lint(`useQuery({ queryKey: ["photoDetails", hash], queryFn: () => fetchPhoto(hash) });`)).toContain(
      "ban/query-key-literal"
    );
    expect(await lint(`client.getQueryData(["photoDetails", hash]);`)).toContain("ban/query-key-literal");
  });

  it.each(["../../api", "../api", "../../../api_client/api"])("reports the singleton imported from %s", async from => {
    expect(await lint(`import { queryClient } from "${from}";`)).toContain("ban/query-client-singleton");
  });

  it("allows other imports from the API module", async () => {
    expect(await lint(`import { apiClient } from "../../api";`)).toEqual([]);
  });
});

// File and function size (eslint.config.mjs, "Size"): the limits fire on a planted file, a route file
// holds one component, and eslint-size-baseline.json holds every file over a limit at exactly its
// measured size, so it can shrink and never grow.
describe("eslint.config.mjs size limits", () => {
  const SIZE_RULES = { lines: "max-lines", function: "max-lines-per-function" };
  const sizeLint = new ESLint({
    cwd,
    overrideConfig: { languageOptions: { parserOptions: { project: null } } },
    ruleFilter: ({ ruleId }) => [...Object.values(SIZE_RULES), "react/no-multi-comp"].includes(ruleId),
  });
  const lint = async (code, file) => {
    const [result] = await sizeLint.lintText(code, { filePath: path.join(cwd, file) });
    expect(result.messages.filter(message => message.fatal)).toEqual([]);
    return result.messages.map(message => message.ruleId);
  };
  const statements = (count, prefix = "") =>
    Array.from({ length: count }, (_, i) => `${prefix}const planted${i} = ${i};`).join("\n");
  // `count` lines in all: the signature, the body and the closing brace.
  const component = (name, count) => `export function ${name}() {\n${statements(count - 3, "  ")}\n  return null;\n}\n`;

  it("fails a file over the line limit, not one at it", async () => {
    expect(await lint(statements(SIZE_LIMITS.lines + 1, "export "), "src/components/sample.ts")).toEqual(["max-lines"]);
    expect(await lint(statements(SIZE_LIMITS.lines, "export "), "src/components/sample.ts")).toEqual([]);
  });

  it("fails a function over the function limit, not one at it", async () => {
    expect(await lint(component("Planted", SIZE_LIMITS.function + 1), "src/components/Planted.tsx")).toEqual([
      "max-lines-per-function",
    ]);
    expect(await lint(component("Planted", SIZE_LIMITS.function), "src/components/Planted.tsx")).toEqual([]);
  });

  it("does not count blank lines and comments", async () => {
    const padded = `${statements(SIZE_LIMITS.lines, "export ")}\n\n// a comment\n/* and\n   another */\n`;
    expect(await lint(padded, "src/components/sample.ts")).toEqual([]);
  });

  it("leaves test code and the generated route tree alone", async () => {
    const big = statements(SIZE_LIMITS.lines + 1, "export ");
    for (const file of ["src/components/Sample.test.tsx", "src/util/sample.test-utils.ts", "src/routeTree.gen.ts"]) {
      expect(await lint(big, file)).toEqual([]);
    }
  });

  it("fails a second component in a route file, not in components/", async () => {
    const twoComponents = `${component("First", 4)}${component("Second", 4)}`;
    expect(await lint(twoComponents, "src/routes/_protected/sample.tsx")).toContain("react/no-multi-comp");
    expect(await lint(twoComponents, "src/components/Sample.tsx")).toEqual([]);
  });

  it("fails a file in the baseline that grows", async () => {
    // The largest file the baseline still holds: a file that is back under the limits has no entry.
    const file = Object.keys(sizeBaseline).find(name => sizeBaseline[name]?.lines > SIZE_LIMITS.lines);
    expect(file).toBeDefined();
    expect(sizeBaseline[file]?.lines).toBeGreaterThan(SIZE_LIMITS.lines);
    const source = readFileSync(path.join(cwd, file), "utf8");
    expect(await lint(source, file)).toEqual([]);
    expect(await lint(`${source}\n${statements(10, "export ")}\n`, file)).toEqual(["max-lines"]);
  });

  /** Every app source file over a limit, with its size per rule (the largest function for the function rule). */
  async function measure() {
    const files = globSync("src/**/*.{ts,tsx}", { cwd })
      .map(file => file.split(path.sep).join("/"))
      .filter(file => matches(file, SIZE_FILES) && !matches(file, SIZE_IGNORES));
    // The default limits everywhere, overriding the baseline, so every file over one reports its size.
    const measuring = new ESLint({
      cwd,
      overrideConfig: [
        { languageOptions: { parserOptions: { project: null } } },
        {
          files: SIZE_FILES,
          rules: Object.fromEntries(
            Object.entries(SIZE_RULES).map(([key, rule]) => [
              rule,
              ["error", { max: SIZE_LIMITS[key], skipBlankLines: true, skipComments: true }],
            ])
          ),
        },
      ],
      ruleFilter: ({ ruleId }) => Object.values(SIZE_RULES).includes(ruleId),
    });
    const sizes = {};
    for (const result of await measuring.lintFiles(files)) {
      const file = path.relative(cwd, result.filePath).split(path.sep).join("/");
      for (const message of result.messages) {
        const key = Object.keys(SIZE_RULES).find(name => SIZE_RULES[name] === message.ruleId);
        const count = Number(/too many lines \((\d+)\)/.exec(message.message)?.[1]);
        expect(key && count, `${file}: ${message.message}`).toBeTruthy();
        sizes[file] = { ...sizes[file], [key]: Math.max(sizes[file]?.[key] ?? 0, count) };
      }
    }
    return sizes;
  }

  /** Largest file first, one line per file: a shape Prettier leaves as it is. */
  function serialise(baseline) {
    const lines = Object.entries(baseline)
      .sort(
        ([fileA, a], [fileB, b]) =>
          (b.lines ?? 0) - (a.lines ?? 0) || (b.function ?? 0) - (a.function ?? 0) || fileA.localeCompare(fileB)
      )
      .map(([file, size]) => {
        const counts = Object.keys(SIZE_RULES).flatMap(key => (size[key] ? [`"${key}": ${size[key]}`] : []));
        return `  ${JSON.stringify(file)}: { ${counts.join(", ")} }`;
      });
    return `{\n${lines.join(",\n")}\n}\n`;
  }

  it("the baseline holds exactly the measured size of every file over a limit", { timeout: 120_000 }, async () => {
    const sizes = await measure();
    const over = [];
    const stale = [];
    const lowered = {};
    for (const file of [...new Set([...Object.keys(sizes), ...Object.keys(sizeBaseline)])].sort()) {
      for (const key of Object.keys(SIZE_RULES)) {
        const now = sizes[file]?.[key] ?? 0;
        const allowed = sizeBaseline[file]?.[key] ?? 0;
        if (now > allowed) over.push(`${file}: ${key} ${now} (allowed ${allowed || SIZE_LIMITS[key]})`);
        if (now < allowed) stale.push(`${file}: ${key} ${now || `under ${SIZE_LIMITS[key]}`} (baseline ${allowed})`);
        if (Math.min(now, allowed) > 0) lowered[file] = { ...lowered[file], [key]: Math.min(now, allowed) };
      }
    }
    expect(over, "Split the file or function (AGENTS.md, Size); the baseline never grows").toEqual([]);
    if (process.env.UPDATE_SIZE_BASELINE) {
      writeFileSync(SIZE_BASELINE_PATH, serialise(lowered));
      return;
    }
    expect(stale, "Lower the baseline: UPDATE_SIZE_BASELINE=1 yarn test eslint.config.test.mjs").toEqual([]);
    expect(readFileSync(SIZE_BASELINE_PATH, "utf8"), "Largest file first, one line per file").toBe(
      serialise(sizeBaseline)
    );
  });
});
