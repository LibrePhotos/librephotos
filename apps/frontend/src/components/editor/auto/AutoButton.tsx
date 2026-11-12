import { Button, Group } from "@mantine/core";
import { IconWand } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";
import { DisabledReason } from "../../common/DisabledReason";
import { useEditor } from "../EditorContext";
import { autoTone, withAutoTone } from "./autoTone";

/**
 * Auto: sets Exposure, Contrast, Highlights, Shadows, Whites and Blacks from the histogram of the
 * photo before its edits (its framing kept), as one `auto` step. In the simple Adjust tab and the
 * advanced Light section.
 */
function AutoButton() {
  const { t } = useTranslation();
  const { session, commands, preview, ready } = useEditor();
  const run = () => {
    const histogram = preview.renderer()?.histogram("before");
    if (!histogram) return;
    commands.apply("auto", withAutoTone(session.committed, autoTone(histogram.luma)));
  };
  return (
    <DisabledReason reason={!ready && t("editor.auto.notReady")} label={t("editor.auto.hint")}>
      <Button size="compact-sm" variant="light" leftSection={<IconWand size={ICON_SIZE.inline} />} onClick={run}>
        {t("editor.auto.label")}
      </Button>
    </DisabledReason>
  );
}

/** Auto on its own row, at the right: above the Light section's sliders and the Adjust tab's. */
export function AutoRow() {
  return (
    <Group justify="flex-end" mb={4}>
      <AutoButton />
    </Group>
  );
}
