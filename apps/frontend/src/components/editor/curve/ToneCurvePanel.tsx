import { Button, Group, Stack } from "@mantine/core";
import type { ParseKeys } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../common/Segmented";
import { useSectionOpen } from "../controls/sectionOpen";
import { useEditor } from "../EditorContext";
import type { CurveChannel } from "../engine/recipe";
import type { HistogramChannel } from "../histogram/histogramModel";
import { useHistogram } from "../histogram/useHistogram";
import { IDENTITY_CURVE, isIdentityCurve } from "./curveModel";
import { ToneCurveEditor } from "./ToneCurveEditor";

const CHANNELS: readonly CurveChannel[] = ["master", "red", "green", "blue"];
/** The channel names (the switch, the reset, a point's name, a history step). */
const CURVE_CHANNEL_LABELS: Readonly<Record<CurveChannel, ParseKeys>> = {
  master: "editor.curve.master",
  red: "editor.curve.red",
  green: "editor.curve.green",
  blue: "editor.curve.blue",
};
const HISTOGRAM_OF: Readonly<Record<CurveChannel, HistogramChannel>> = {
  master: "luma",
  red: "r",
  green: "g",
  blue: "b",
};

/** The Tone curve section: the channel switch (all, red, green, blue), its curve, and its reset. */
export function ToneCurvePanel() {
  const { t } = useTranslation();
  const { session, commands } = useEditor();
  const [channel, setChannel] = useState<CurveChannel>("master");
  const histogram = useHistogram(useSectionOpen());
  const points = session.recipe.curve[channel];
  const control = `curve.${channel}` as const;
  const name = t(CURVE_CHANNEL_LABELS[channel]);
  return (
    <Stack gap="xs">
      <Segmented<CurveChannel>
        aria-label={t("editor.curve.channel")}
        value={channel}
        onChange={setChannel}
        segments={CHANNELS.map(value => ({ value, label: t(CURVE_CHANNEL_LABELS[value]) }))}
      />
      <ToneCurveEditor
        channel={channel}
        points={points}
        bins={histogram?.[HISTOGRAM_OF[channel]] ?? null}
        channelName={name}
        onLive={next => commands.setControl(control, next, "live")}
        onCommit={commands.commit}
        onSet={next => commands.setControl(control, next, "set")}
      />
      {!isIdentityCurve(points) && (
        <Group justify="flex-end">
          <Button
            size="compact-sm"
            variant="subtle"
            color="gray"
            onClick={() => commands.setControl(control, IDENTITY_CURVE, "set")}
          >
            {t("editor.curve.reset", { channel: name })}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
