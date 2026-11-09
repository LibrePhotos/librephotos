import classes from "./toolbarLook.module.css";

/**
 * The look of every button in a page header's toolbar (Filter, Select, sort, the "⋮" and display
 * menus, Manage faces, Empty trash): a neutral subtle button, tinted in the primary colour only
 * while it is on (a filter set, select mode, a sort that is not the default). Spread it on a
 * Button with `h={TOOLBAR_CONTROL_HEIGHT}` or an ActionIcon with `size={TOOLBAR_ACTION_SIZE}`, so
 * the row has one height. A page's one main action (New album) is a filled Button instead.
 */
export function toolbarLook(active = false) {
  return active
    ? ({ variant: "light", className: `${classes.control} ${classes.active}` } as const)
    : ({ variant: "subtle", color: "gray", className: `${classes.control} ${classes.neutral}` } as const);
}
