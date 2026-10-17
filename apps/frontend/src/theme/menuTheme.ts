import { Menu, type MenuProps } from "@mantine/core";

/** Space kept between a menu and the window edge. */
const VIEWPORT_PADDING = 8;

/**
 * Every menu fits the window: the dropdown is capped at the height left between its button and the
 * window edge and scrolls past that. Without it the bulk-actions menu (22 items) ran off the bottom
 * of the window and "Move to trash" could only be reached at 50 % zoom (#2707).
 */
export function capToWindow({
  availableHeight,
  elements,
}: {
  availableHeight: number;
  elements: { floating: HTMLElement };
}) {
  Object.assign(elements.floating.style, { maxHeight: `${Math.max(availableHeight, 0)}px`, overflowY: "auto" });
}

// `flip` picks the side with more room when neither fits, so a button low on the page opens upward
// instead of into a sliver.
const fitWindowMiddlewares = {
  flip: { fallbackStrategy: "bestFit", padding: VIEWPORT_PADDING },
  shift: true,
  size: { padding: VIEWPORT_PADDING, apply: capToWindow },
} satisfies NonNullable<MenuProps["middlewares"]>;

/**
 * Theme defaults for Menu and Menu.Sub (App.tsx). A `middlewares` prop on one menu would replace these
 * whole, so lint bans it (`ban/menu-middlewares`).
 */
export const menuThemeComponents = {
  Menu: Menu.extend({ defaultProps: { middlewares: fitWindowMiddlewares } }),
  // A submenu renders inside its parent's dropdown, which now scrolls: positioned `fixed` it is
  // placed against the window instead and is not clipped by that scroll box. Mantine's own submenu
  // default shifts along the cross axis, so it stays level with its item.
  MenuSub: Menu.Sub.extend({
    defaultProps: {
      floatingStrategy: "fixed",
      middlewares: { ...fitWindowMiddlewares, shift: { crossAxis: true } },
    },
  }),
};
