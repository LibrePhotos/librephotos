import { ActionIcon, Button, Menu, Text, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowLeft,
  IconClipboard,
  IconColumns2,
  IconCopy,
  IconDotsVertical,
  IconHistory,
  IconRestore,
  IconSquareHalf,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";
import { DisabledReason } from "../../common/DisabledReason";
import { menuShortcut } from "../../common/menuShortcut";
import { Segmented } from "../../common/Segmented";
import { TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "../../lightbox/LightboxToolbarButton";
import { modShortcut } from "./editorHotkeys";
import type { EditorMode } from "./editorMode";
import classes from "./EditorTopBar.module.css";
import { useHoldToCompare } from "./useHoldToCompare";

export type EditorTopBarProps = Readonly<{
  fileName: string;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Held down (the button, or the backslash key): the picture without its edits. */
  onCompare: (holding: boolean) => void;
  comparing: boolean;
  /** The split view (before left of a divider, after right) is on. */
  splitView: boolean;
  onToggleSplit: () => void;
  /** Why the split view cannot be switched on now (the crop tool); false when it can. */
  splitReason: string | false;
  /** Copy settings and Paste settings, in the ⋮. */
  onCopy: () => void;
  onPaste: () => void;
  /** The recipe changes something: Reset has work to do. */
  canReset: boolean;
  onReset: () => void;
  /** The photo has a saved edit to take back: Revert to original is offered. */
  canRevert: boolean;
  onRevert: () => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  /** A phone: icons only, no file name. */
  compact: boolean;
}>;

/** One icon button of the bar, named and with its tooltip. */
function BarButton({
  label,
  reason,
  onClick,
  children,
}: Readonly<{ label: string; reason?: string | false; onClick: () => void; children: React.ReactNode }>) {
  return (
    <DisabledReason reason={reason} label={label} position="bottom">
      <ActionIcon {...TOOLBAR_BUTTON} aria-label={label} onClick={onClick}>
        {children}
      </ActionIcon>
    </DisabledReason>
  );
}

/**
 * The editor's top bar: close, the file name, Simple or Advanced (on a phone it is over the panel), undo and redo, hold to compare,
 * Reset, a ⋮ with Revert to original, and Save.
 */
export function EditorTopBar(props: EditorTopBarProps) {
  const { t } = useTranslation();
  const { mode, onModeChange, canUndo, canRedo, onUndo, onRedo, canReset, onReset, compact } = props;
  const compare = useHoldToCompare(props.onCompare);
  const undoLabel = t("editor.undo", { shortcut: modShortcut("Z") });
  const redoLabel = t("editor.redo", { shortcut: modShortcut("Shift+Z") });
  const compareLabel = t("editor.compare");
  const resetLabel = t("editor.reset");
  const splitLabel = t("editor.split.toggle");
  return (
    <header className={classes.bar} data-compact={compact || undefined}>
      <Tooltip label={t("editor.close")} position="bottom">
        <ActionIcon {...TOOLBAR_BUTTON} aria-label={t("editor.close")} onClick={props.onClose}>
          <IconArrowLeft size={TOOLBAR_ICON_SIZE} />
        </ActionIcon>
      </Tooltip>
      {!compact && (
        <Text className={classes.title} size="sm" fw={500} title={props.fileName}>
          {props.fileName}
        </Text>
      )}
      {!compact && (
        <div className={classes.mode}>
          <ModeSwitch mode={mode} onModeChange={onModeChange} />
        </div>
      )}
      <div className={classes.actions}>
        <BarButton label={undoLabel} reason={!canUndo && t("editor.nothingToUndo")} onClick={onUndo}>
          <IconArrowBackUp size={TOOLBAR_ICON_SIZE} />
        </BarButton>
        <BarButton label={redoLabel} reason={!canRedo && t("editor.nothingToRedo")} onClick={onRedo}>
          <IconArrowForwardUp size={TOOLBAR_ICON_SIZE} />
        </BarButton>
        <Tooltip label={compareLabel} position="bottom">
          <ActionIcon
            {...TOOLBAR_BUTTON}
            aria-label={compareLabel}
            aria-pressed={props.comparing}
            mod={{ active: props.comparing }}
            {...compare}
          >
            <IconSquareHalf size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </Tooltip>
        <DisabledReason reason={props.splitReason} label={splitLabel} position="bottom">
          <ActionIcon
            {...TOOLBAR_BUTTON}
            aria-label={splitLabel}
            aria-pressed={props.splitView}
            mod={{ active: props.splitView }}
            onClick={props.onToggleSplit}
          >
            <IconColumns2 size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </DisabledReason>
        {!compact && (
          <BarButton label={resetLabel} reason={!canReset && t("editor.nothingToReset")} onClick={onReset}>
            <IconRestore size={TOOLBAR_ICON_SIZE} />
          </BarButton>
        )}
        <MoreMenu {...props} />
        <DisabledReason reason={!props.dirty && t("editor.nothingToSave")} position="bottom">
          <Button size="compact-md" ml={4} loading={props.saving} onClick={props.onSave}>
            {t("editor.save")}
          </Button>
        </DisabledReason>
      </div>
    </header>
  );
}

/** Simple or Advanced: in the bar on a wide screen, over the panel on a phone. */
export function ModeSwitch({ mode, onModeChange }: Pick<EditorTopBarProps, "mode" | "onModeChange">) {
  const { t } = useTranslation();
  return (
    <Segmented<EditorMode>
      aria-label={t("editor.mode.label")}
      value={mode}
      onChange={onModeChange}
      segments={[
        { value: "simple", label: t("editor.mode.simple") },
        { value: "advanced", label: t("editor.mode.advanced") },
      ]}
    />
  );
}

/** The ⋮: Copy and Paste settings, Reset on a phone, and Revert to original for a photo with a saved edit. */
function MoreMenu({ compact, canReset, onReset, canRevert, onRevert, onCopy, onPaste }: EditorTopBarProps) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const label = t("editor.more");
  return (
    <Menu position="bottom-end" withinPortal={false} opened={opened} onChange={next => (next ? open() : close())}>
      <Menu.Target>
        <Tooltip label={label} position="bottom" disabled={opened}>
          <ActionIcon {...TOOLBAR_BUTTON} aria-label={label}>
            <IconDotsVertical size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconCopy size={ICON_SIZE.menu} />} {...menuShortcut("mod+Shift+C")} onClick={onCopy}>
          {t("editor.copyPaste.copy")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconClipboard size={ICON_SIZE.menu} />}
          {...menuShortcut("mod+Shift+V")}
          onClick={onPaste}
        >
          {t("editor.copyPaste.paste")}
        </Menu.Item>
        {(compact || canRevert) && <Menu.Divider />}
        {compact && (
          <DisabledReason reason={!canReset && t("editor.nothingToReset")} position="left">
            <Menu.Item leftSection={<IconRestore size={ICON_SIZE.menu} />} onClick={onReset}>
              {t("editor.reset")}
            </Menu.Item>
          </DisabledReason>
        )}
        {canRevert && (
          <Menu.Item leftSection={<IconHistory size={ICON_SIZE.menu} />} onClick={onRevert}>
            {t("editor.revert")}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
