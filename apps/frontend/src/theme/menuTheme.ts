import { Menu, type MenuProps } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { createElement } from "react";
import classes from "./menuTheme.module.css";

/** Space kept between a menu and the window edge. */
const VIEWPORT_PADDING = 8;

/** Below Mantine's `sm` breakpoint (48em) every menu opens as an action sheet. */
export const SHEET_QUERY = "(max-width: 47.99em)";

/** The tallest a phone's action sheet gets, as a share of the window; it scrolls past that. */
const SHEET_MAX_HEIGHT = 0.8;

type FloatingState = {
  availableHeight: number;
  /** Where floating-ui places the dropdown (its inline `left` and `top`). */
  x: number;
  y: number;
  elements: { floating: HTMLElement };
};

/**
 * Every menu fits the window: the dropdown is capped at the height left between its button and the
 * window edge and scrolls past that. Without it the bulk-actions menu (22 items) ran off the bottom
 * of the window and "Move to trash" could only be reached at 50 % zoom (#2707).
 */
export function capToWindow({ availableHeight, elements }: Pick<FloatingState, "availableHeight" | "elements">) {
  Object.assign(elements.floating.style, { maxHeight: `${Math.max(availableHeight, 0)}px`, overflowY: "auto" });
}

/**
 * A phone's menu is an action sheet, as in Google Photos and Apple Photos: the whole width of the
 * window at its bottom edge (menuTheme.module.css draws it while `data-sheet` is set). Mantine
 * writes floating-ui's `left` and `top` inline on every render, so the sheet keeps them and moves
 * by its margins instead, which React leaves alone: `left + margin-left` is 0 and `top +
 * margin-top` the window's height less the sheet's own.
 */
export function placeAsSheet({ x, y, elements }: Pick<FloatingState, "x" | "y" | "elements">) {
  const { floating } = elements;
  floating.dataset.sheet = "true";
  const width = `${document.documentElement.clientWidth}px`;
  Object.assign(floating.style, {
    minWidth: width,
    maxWidth: width,
    maxHeight: `${Math.round(window.innerHeight * SHEET_MAX_HEIGHT)}px`,
    overflowY: "auto",
    marginLeft: `${-x}px`,
  });
  // Measured once its width and cap are set: both change its height.
  floating.style.marginTop = `${window.innerHeight - y - floating.offsetHeight}px`;
}

/** Back to a dropdown under its button, when the window grows past a phone's. */
function clearSheet(floating: HTMLElement) {
  if (floating.dataset.sheet === undefined) return;
  delete floating.dataset.sheet;
  Object.assign(floating.style, { minWidth: "", maxWidth: "", marginLeft: "", marginTop: "" });
}

function isPhone() {
  return typeof window.matchMedia === "function" && window.matchMedia(SHEET_QUERY).matches;
}

/** The size middleware's `apply`: a sheet on a phone, a dropdown capped at the window elsewhere. */
export function fitWindow(state: FloatingState) {
  if (isPhone()) return placeAsSheet(state);
  clearSheet(state.elements.floating);
  return capToWindow(state);
}

// `flip` picks the side with more room when neither fits, so a button low on the page opens upward
// instead of into a sliver.
const fitWindowMiddlewares = {
  flip: { fallbackStrategy: "bestFit", padding: VIEWPORT_PADDING },
  shift: true,
  size: { padding: VIEWPORT_PADDING, apply: fitWindow },
} satisfies NonNullable<MenuProps["middlewares"]>;

const menuClassNames = {
  dropdown: classes.dropdown,
  item: classes.item,
  itemLabel: classes.itemLabel,
  itemSection: classes.itemSection,
  itemIndicator: classes.itemIndicator,
  label: classes.label,
  divider: classes.divider,
};

/**
 * Theme defaults for Menu and Menu.Sub (App.tsx): one look for every menu (menuTheme.module.css:
 * 18 px dimmed icons, 12 px semibold group titles, a trailing check in the primary colour for the
 * chosen item, a fade at an edge that scrolls) and the window-fitting placement above, which turns
 * into an action sheet over a scrim on a phone. The scrim is always rendered and shown only below
 * `sm`: it takes the tap that closes the sheet, so that tap does not land on the page under it.
 *
 * A `middlewares` prop on one menu would replace the placement whole, so lint bans it
 * (`ban/menu-middlewares`).
 */
export const menuThemeComponents = {
  Menu: Menu.extend({
    defaultProps: {
      middlewares: fitWindowMiddlewares,
      radius: "md",
      shadow: "md",
      offset: 6,
      checkIcon: createElement(IconCheck, { size: 16, stroke: 2 }),
      withOverlay: true,
      overlayProps: { fixed: true, backgroundOpacity: 0.4, className: classes.scrim },
    },
    classNames: menuClassNames,
  }),
  // A submenu renders inside its parent's dropdown, which now scrolls: positioned `fixed` it is
  // placed against the window instead and is not clipped by that scroll box. Mantine's own submenu
  // default shifts along the cross axis, so it stays level with its item. On a phone it is a
  // second sheet over the first.
  MenuSub: Menu.Sub.extend({
    defaultProps: {
      floatingStrategy: "fixed",
      middlewares: { ...fitWindowMiddlewares, shift: { crossAxis: true } },
    },
  }),
};
