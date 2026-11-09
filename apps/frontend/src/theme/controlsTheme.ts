import { Button, Checkbox, Input, Pagination, Radio, Switch } from "@mantine/core";
import classes from "./controlsTheme.module.css";

/**
 * Theme defaults for the form controls (App.tsx): a visible off switch with a plain thumb, radio and checkbox rings
 * that show in both schemes, one input look (filled grey with a 1px border) and disabled buttons
 * that keep their outline. The looks are in controlsTheme.module.css.
 */
export const controlsTheme = {
  // A plain round thumb with a soft shadow on the md track (38x22): Mantine's default thumb carries
  // a dot that read as a radio button inside the track. The label keeps the sm text of the other
  // controls, so a switch row reads like a checkbox row.
  Switch: Switch.extend({
    defaultProps: { withThumbIndicator: false, size: "md" },
    classNames: {
      track: classes.switchTrack,
      thumb: classes.switchThumb,
      labelWrapper: classes.switchText,
      description: classes.switchDescription,
    },
  }),
  Radio: Radio.extend({ classNames: { radio: classes.radio } }),
  Checkbox: Checkbox.extend({ classNames: { input: classes.checkbox } }),
  Input: Input.extend({ classNames: { wrapper: classes.inputWrapper } }),
  Button: Button.extend({ classNames: { root: classes.button } }),
  // The current page's number in the scheme's contrast colour: white on the pastel dark accent was
  // 1.6:1.
  Pagination: Pagination.extend({
    vars: () => ({ root: { "--pagination-active-color": "var(--mantine-primary-color-contrast)" } }),
  }),
};
