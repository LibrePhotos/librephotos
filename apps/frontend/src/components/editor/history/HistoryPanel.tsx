import { Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useEditor } from "../EditorContext";
import { historyLabel } from "./historyLabel";
import classes from "./HistoryPanel.module.css";

type RowProps = Readonly<{ label: string; current: boolean; undone: boolean; onClick: () => void }>;

function Row({ label, current, undone, onClick }: RowProps) {
  return (
    <li>
      <UnstyledButton
        className={classes.row}
        aria-current={current ? "step" : undefined}
        data-undone={undone || undefined}
        onClick={onClick}
      >
        <Text size="sm" component="span" className={classes.label}>
          {label}
        </Text>
      </UnstyledButton>
    </li>
  );
}

/**
 * The History section: the steps newest first and "Original" at the bottom (the cursor at -1), the
 * current one marked, the undone ones (after the cursor) dimmed until a new edit drops them. A
 * click goes to that step without adding one. At most 200 steps (the history's limit), in a list
 * that scrolls on its own.
 */
export function HistoryPanel() {
  const { t } = useTranslation();
  const { session, commands } = useEditor();
  const steps = session.history.map((step, index) => ({ index, label: historyLabel(step, t) })).reverse();
  return (
    <div className={classes.scroller}>
      <ol className={classes.list} aria-label={t("editor.history.list")}>
        {steps.map(({ index, label }) => (
          <Row
            key={index}
            label={label}
            current={index === session.cursor}
            undone={index > session.cursor}
            onClick={() => commands.goto(index)}
          />
        ))}
        <Row
          label={t("editor.history.original")}
          current={session.cursor === -1}
          undone={false}
          onClick={() => commands.goto(-1)}
        />
      </ol>
    </div>
  );
}
