import type { MantineColorSchemeManager } from "@mantine/core";
import { MantineProvider, useMantineCssVariablesResolver, useMantineEnv } from "@mantine/core";
import cx from "clsx";
import React, { useCallback, useRef } from "react";
import classes from "./ViewerDarkScope.module.css";

/** A scheme store that always says dark and keeps nothing: the app's own choice stays untouched. */
const ALWAYS_DARK: MantineColorSchemeManager = {
  get: () => "dark",
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

/**
 * The photo viewer is dark in either colour scheme, as in Google Photos, Apple Photos and Immich: a
 * light info panel next to the black stage read as a second app. Everything inside renders as in the
 * dark scheme: Mantine's colour variables are set again on this element (the provider writes them
 * for its class instead of `:root`), its scheme attribute picks the dark component styles, and
 * `useComputedColorScheme` says dark (the map's style follows it). The theme and the CSS variables
 * resolver are the app's; only the scheme differs. Portalled dropdowns and dialogs opened from here
 * keep the app's scheme.
 */
export function ViewerDarkScope({ className, children }: Readonly<{ className?: string; children: React.ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const resolver = useMantineCssVariablesResolver();
  const env = useMantineEnv();
  const getRootElement = useCallback(() => ref.current ?? undefined, []);
  return (
    <MantineProvider
      forceColorScheme="dark"
      defaultColorScheme="dark"
      colorSchemeManager={ALWAYS_DARK}
      cssVariablesSelector={`.${classes.scope}`}
      cssVariablesResolver={resolver}
      getRootElement={getRootElement}
      withGlobalClasses={false}
      env={env}
    >
      <div ref={ref} className={cx(classes.scope, className)} data-mantine-color-scheme="dark">
        {children}
      </div>
    </MantineProvider>
  );
}
