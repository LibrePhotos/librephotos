// @vitest-environment node
// Plants one violation per convention ban (eslint.config.mjs) and lints it, through the real config,
// at a file of every scope the bans name: each ban must fire where it applies and stay quiet in its
// `allowIn` files, whatever the other bans and blocks do.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import config, { globalBans, importBans, propertyBans, syntaxBans } from "./eslint.config.mjs";

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
  "tile-index": `const plantedIndex = rowIndex * columns + columnIndex;`,
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
  "local-storage": `const plantedLocal = localStorage.getItem("key");`,
  "session-storage": `const plantedSession = sessionStorage.getItem("key");`,
  "custom-event": `const plantedEvent = new CustomEvent("planted");`,
  "window-local-storage": `const plantedWindowLocal = window.localStorage;`,
  "window-session-storage": `const plantedWindowSession = window.sessionStorage;`,
  "globalthis-local-storage": `const plantedGlobalLocal = globalThis.localStorage;`,
  "globalthis-session-storage": `const plantedGlobalSession = globalThis.sessionStorage;`,
  "window-dispatch-event": `window.dispatchEvent(new Event("resize"));`,
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
  ])("%s: ban/%s fires = %s", async (file, id, fires) => {
    const fired = await firedBans(planted[id], file);
    expect(fired.has(`ban/${id}`)).toBe(fires);
  });
});
