import { CloseButton, Drawer } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./BottomSheet.module.css";
import { useSheetDrag } from "./useSheetDrag";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The sheet's heading, with a close button beside it; left out, the sheet is named by `label`. */
  title?: React.ReactNode;
  /** The sheet's accessible name when it has no title. */
  label?: string;
  /** "auto": as tall as its content, up to 90% of the screen. "tall": 85% of it whatever it holds. */
  size?: "auto" | "tall";
  /** Stays at the bottom while the content scrolls (e.g. "Show 12 photos"). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}>;

/**
 * The phone's bottom sheet, as Google Photos and Apple Photos have it: rounded top corners, a grab
 * handle, the heading and its close button fixed while the content scrolls, an optional footer.
 * Dragging the handle or the heading down closes it; a short drag springs back.
 */
export function BottomSheet({ opened, onClose, title, label, size = "auto", footer, children }: Props) {
  const { t } = useTranslation();
  const { sheet, handlers, reset } = useSheetDrag<HTMLDivElement>(onClose);

  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position="bottom"
      size={size === "tall" ? "85dvh" : "auto"}
      onExitTransitionEnd={reset}
    >
      <Drawer.Overlay backgroundOpacity={0.4} />
      <Drawer.Content
        ref={sheet}
        classNames={{ content: classes.sheet }}
        data-size={size}
        aria-label={title ? undefined : label}
      >
        <div className={classes.grab} {...handlers}>
          <div className={classes.handle} aria-hidden />
          {title && (
            <div className={classes.header}>
              <Drawer.Title className={classes.title}>{title}</Drawer.Title>
              <CloseButton aria-label={t("close")} onClick={onClose} />
            </div>
          )}
        </div>
        <div className={classes.body}>{children}</div>
        {footer && <div className={classes.footer}>{footer}</div>}
      </Drawer.Content>
    </Drawer.Root>
  );
}
