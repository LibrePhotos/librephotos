import { ActionIcon, Tooltip } from "@mantine/core";
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconFocus,
  IconLine,
  IconMinus,
  IconPlus,
  IconRouteAltLeft,
  IconStairs,
  IconTopologyRing,
  IconTree,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { formatPercent } from "../../util/formatCount";
import styles from "./LocationLink.module.css";

export type TreeLayout = "cartesian" | "polar";
export type TreeOrientation = "horizontal" | "vertical";
export type TreeLinkType = "diagonal" | "step" | "curve" | "line";

type ToggleOption<T extends string> = Readonly<{ value: T; label: ParseKeys; icon: ReactNode }>;

const LAYOUTS: readonly ToggleOption<TreeLayout>[] = [
  { value: "cartesian", label: "placetree.cartesian", icon: <IconTree size={18} /> },
  { value: "polar", label: "placetree.polar", icon: <IconTopologyRing size={18} /> },
];

const ORIENTATIONS: readonly ToggleOption<TreeOrientation>[] = [
  { value: "horizontal", label: "placetree.horizontal", icon: <IconArrowsHorizontal size={18} /> },
  { value: "vertical", label: "placetree.vertical", icon: <IconArrowsVertical size={18} /> },
];

// "diagonal" is drawn but has no button of its own.
const LINK_TYPES: readonly ToggleOption<TreeLinkType>[] = [
  { value: "curve", label: "placetree.curve", icon: <IconRouteAltLeft size={18} /> },
  { value: "step", label: "placetree.step", icon: <IconStairs size={18} /> },
  { value: "line", label: "placetree.line", icon: <IconLine size={18} /> },
];

type ToggleGroupProps<T extends string> = Readonly<{
  label: ParseKeys;
  options: readonly ToggleOption<T>[];
  value: T;
  color: string;
  onChange: (value: T) => void;
}>;

/** One set of mutually exclusive toggles: each is a named button that says whether it is the chosen one. */
function ToggleGroup<T extends string>({ label, options, value, color, onChange }: ToggleGroupProps<T>) {
  const { t } = useTranslation();
  return (
    <div className={styles.toolbarGroup} role="group" aria-label={t(label)}>
      {options.map(option => {
        const pressed = option.value === value;
        return (
          <Tooltip key={option.value} label={t(option.label)} position="bottom" withArrow>
            <ActionIcon
              variant={pressed ? "filled" : "subtle"}
              color={pressed ? color : "gray"}
              size="md"
              aria-label={t(option.label)}
              aria-pressed={pressed}
              onClick={() => onChange(option.value)}
              className={styles.toolbarButton}
            >
              {option.icon}
            </ActionIcon>
          </Tooltip>
        );
      })}
    </div>
  );
}

type ToolbarProps = Readonly<{
  layout: TreeLayout;
  orientation: TreeOrientation;
  linkType: TreeLinkType;
  onLayoutChange: (layout: TreeLayout) => void;
  onOrientationChange: (orientation: TreeOrientation) => void;
  onLinkTypeChange: (linkType: TreeLinkType) => void;
}>;

/** The place tree's layout, direction (tree layout only) and connection style toggles. */
export function PlaceTreeToolbar(props: ToolbarProps) {
  return (
    <div className={styles.controlsToolbar}>
      <ToggleGroup
        label="placetree.layout"
        options={LAYOUTS}
        value={props.layout}
        color="blue"
        onChange={props.onLayoutChange}
      />
      {props.layout === "cartesian" && (
        <>
          <div className={styles.toolbarDivider} />
          <ToggleGroup
            label="placetree.orientation"
            options={ORIENTATIONS}
            value={props.orientation}
            color="cyan"
            onChange={props.onOrientationChange}
          />
        </>
      )}
      <div className={styles.toolbarDivider} />
      <ToggleGroup
        label="placetree.linkStyle"
        options={LINK_TYPES}
        value={props.linkType}
        color="violet"
        onChange={props.onLinkTypeChange}
      />
    </div>
  );
}

type ZoomButtonProps = Readonly<{ label: ParseKeys; icon: ReactNode; onClick: () => void }>;

function ZoomButton({ label, icon, onClick }: ZoomButtonProps) {
  const { t } = useTranslation();
  return (
    <Tooltip label={t(label)} position="left">
      <button className={styles.zoomButton} onClick={onClick} type="button" aria-label={t(label)}>
        {icon}
      </button>
    </Tooltip>
  );
}

type ZoomProps = Readonly<{ zoom: number; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }>;

/** Zoom in, the zoom level, zoom out and reset, in the place tree's corner. */
export function PlaceTreeZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: ZoomProps) {
  const locale = useFormatLocale();
  return (
    <div className={styles.zoomControls}>
      <ZoomButton label="placetree.zoomIn" icon={<IconPlus size={18} />} onClick={onZoomIn} />
      <div className={styles.zoomLevel}>{formatPercent(zoom, locale, 0)}</div>
      <ZoomButton label="placetree.zoomOut" icon={<IconMinus size={18} />} onClick={onZoomOut} />
      <div className={styles.zoomDivider} />
      <ZoomButton label="placetree.reset" icon={<IconFocus size={18} />} onClick={onReset} />
    </div>
  );
}
