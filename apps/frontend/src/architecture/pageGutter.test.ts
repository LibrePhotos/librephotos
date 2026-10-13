/**
 * Every page keeps the same horizontal gutter, PAGE_GUTTER (10px) from the edge of the app shell,
 * which adds none: PageHeader and PageBody keep it, and so do PhotoListView's grid and TileGrid.
 * The sharing pages wrapped themselves in `p="md"` and the photo page in a `Container`, so the
 * title and the content jumped sideways between routes.
 *
 * A route file therefore puts no horizontal padding from the theme's sizes (`p="md"`,
 * `px={isMobile ? "xs" : "md"}`) on a layout element (Box, Stack, Group, Flex, Center, SimpleGrid)
 * and uses no `Container`: its content goes in `PageBody`. Vertical padding (`pt`, `pb`, `py`) is
 * free, and so is the padding inside a card (`Paper`, `Card`) or inside a component.
 *
 * The settings-type pages (Settings, Profile, Library, Admin, Jobs, job detail) are the one
 * deliberate exception: a centred `Container` (960px, 16px padding) for forms and tables, rendered
 * from their components. ALLOW_LIST holds the route file among them; it only shrinks.
 */
import { describe, expect, it } from "vitest";

const ALLOW_LIST = new Set<string>(["/src/routes/_protected/jobs/index.tsx"]);

const SIZE = "(xs|sm|md|lg|xl)";
const SIDE = "(p|px|pl|pr|ps|pe)";
const LAYOUT = "(Box|Stack|Group|Flex|Center|SimpleGrid)";
// The opening tag up to the padding prop; a `>` inside an earlier prop (an arrow function) ends it early
const THEME_PADDING = new RegExp(`<${LAYOUT}\\b[^>]*\\s${SIDE}=(["']${SIZE}["']|\\{[^}]*["']${SIZE}["'][^}]*\\})`);
const CONTAINER = /<Container[\s>]/;

function setsOwnGutter(source: string): boolean {
  return THEME_PADDING.test(source) || CONTAINER.test(source);
}

const sources = import.meta.glob<string>(
  ["/src/routes/**/*.tsx", "!/src/routes/**/*.test.tsx", "!/src/routes/**/-*.tsx"],
  { query: "?raw", import: "default", eager: true }
);

describe("page gutter", () => {
  it("is left to PageHeader and PageBody by every route file", () => {
    const offenders = Object.entries(sources)
      .filter(([path, source]) => !ALLOW_LIST.has(path) && setsOwnGutter(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the allow-list to files that still need it", () => {
    const stale = [...ALLOW_LIST].filter(path => {
      const source = sources[path];
      return source === undefined || !setsOwnGutter(source);
    });

    expect(stale).toEqual([]);
  });

  it("flags theme padding and a Container, and passes vertical padding and PageBody", () => {
    expect(setsOwnGutter(`<Stack p="md" gap={0}>`)).toBe(true);
    expect(setsOwnGutter(`<Box px='xs'>`)).toBe(true);
    expect(setsOwnGutter(`<Container fluid p={isMobile ? "xs" : "md"}>`)).toBe(true);
    expect(setsOwnGutter(`<Container>`)).toBe(true);

    expect(setsOwnGutter(`<Tabs.Panel value="albums" pt="md">`)).toBe(false);
    expect(setsOwnGutter(`<Center py="xl">`)).toBe(false);
    expect(setsOwnGutter(`<PageBody gap="md">`)).toBe(false);
    expect(setsOwnGutter(`<Flex direction="column" px={8}>`)).toBe(false);
    expect(setsOwnGutter(`<Paper shadow="sm" p={isMobile ? "xs" : "md"}>`)).toBe(false);
    expect(setsOwnGutter(`<ContainerQuery>`)).toBe(false);
  });
});
