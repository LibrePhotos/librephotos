import { Tooltip } from "@mantine/core";
import classes from "./tooltipTheme.module.css";

/**
 * Theme defaults for tooltips (App.tsx). They open on hover after a short pause and on keyboard
 * focus, never on a tap, and stay away from touch screens and from under an open menu
 * (tooltipTheme.module.css).
 */
export const tooltipTheme = {
  Tooltip: Tooltip.extend({
    defaultProps: { events: { hover: true, focus: true, touch: false }, openDelay: 400 },
    classNames: { tooltip: classes.tooltip },
  }),
};
