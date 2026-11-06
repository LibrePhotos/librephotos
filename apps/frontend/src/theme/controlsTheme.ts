import { Button, Checkbox, Input, Radio, Switch } from "@mantine/core";
import classes from "./controlsTheme.module.css";

/**
 * Theme defaults for the form controls (App.tsx): a visible off switch, radio and checkbox rings
 * that show in both schemes, one input look (filled grey with a 1px border) and disabled buttons
 * that keep their outline. The looks are in controlsTheme.module.css.
 */
export const controlsTheme = {
  Switch: Switch.extend({ classNames: { track: classes.switchTrack } }),
  Radio: Radio.extend({ classNames: { radio: classes.radio } }),
  Checkbox: Checkbox.extend({ classNames: { input: classes.checkbox } }),
  Input: Input.extend({ classNames: { wrapper: classes.inputWrapper } }),
  Button: Button.extend({ classNames: { root: classes.button } }),
};
