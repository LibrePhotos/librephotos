import type { ActionIconProps } from "@mantine/core";
import { ActionIcon, Tooltip } from "@mantine/core";
import React from "react";
import classes from "./LightboxControls.module.css";

/** The toolbar's icon size: one size for every button, as in Google Photos and Immich. */
export const TOOLBAR_ICON_SIZE = 20;

/**
 * The look of every toolbar button: an icon in a 40px round hit area with a light tint on hover
 * (LightboxControls.module.css). Spread on an ActionIcon that a DisabledReason or a Menu.Target
 * wraps, which hand their props to the ActionIcon itself.
 */
export const TOOLBAR_BUTTON = {
  variant: "subtle",
  color: "gray",
  size: 40,
  radius: "xl",
  className: classes.button,
} as const satisfies ActionIconProps;

type Props = Readonly<
  {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    /** Drawn as switched on (the open info panel). Its label says so too. */
    active?: boolean;
  } & Pick<ActionIconProps, "loading">
>;

/** One button of the lightbox toolbar, named and with a tooltip. */
export function LightboxToolbarButton({ label, onClick, children, active = false, loading }: Props) {
  return (
    <Tooltip label={label} position="bottom" withArrow>
      <ActionIcon {...TOOLBAR_BUTTON} mod={{ active }} aria-label={label} onClick={onClick} loading={loading}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
