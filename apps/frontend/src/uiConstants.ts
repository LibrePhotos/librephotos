export const TOP_MENU_HEIGHT = 55; // don't change this
export const LEFT_MENU_WIDTH = 200; // don't change this
export const FOOTER_HEIGHT = 50;
export const SUPPORT_LINK = "https://github.com/sponsors/derneuere";
export const DOCUMENTATION_LINK = "https://docs.librephotos.com";

// Shared icon sizes (px). Use these instead of literals so toolbars line up.
export const ICON_SIZE = {
  menu: 14, // icons in menu items (leftSection)
  inline: 16, // small inline icons and loaders
  lightbox: 18, // lightbox toolbar, its menu and the grid overlays
  overlay: 18, // tile overlays (favourite star, stack indicator)
  toolbar: 20, // grid and header toolbar icons
} as const;

// ActionIcon size for grid and header toolbars (34 px). Its icons use ICON_SIZE.toolbar.
export const TOOLBAR_ACTION_SIZE = "lg";
// Height of a text button in the same toolbar row: the lg ActionIcon size from Mantine.
// Not var(--ai-size-lg): ActionIcon defines that variable on its own root only, so on a
// Button it is undefined and the height falls back to auto (22 px for an xs button).
export const TOOLBAR_CONTROL_HEIGHT = "calc(2.125rem * var(--mantine-scale))";

// Horizontal inset (px) of a page's content from the edge of the app shell, which adds none:
// PageHeader's padding, PageBody (components/PageBody.tsx), PhotoListView's grid and TileGrid's
// gutter plus cell padding all keep it, so content edges stay put from one route to the next.
export const PAGE_GUTTER = 10;

// Icon size (px) of the page header (components/PageHeader.tsx): between the 50px album icons
// and the 35px settings icons, so one page-title icon reads the same size on every page.
export const PAGE_HEADER_ICON_SIZE = 40;

// Colour of the favourite star everywhere it appears.
export const FAVORITE_COLOR = "var(--mantine-color-yellow-5)";
