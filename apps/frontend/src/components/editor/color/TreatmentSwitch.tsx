import { Box } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "../../common/Segmented";
import { useEditor } from "../EditorContext";
import type { Recipe } from "../engine/recipe";

type Treatment = Recipe["color"]["treatment"];

/** Color or Black & white, at the top of the Color section: one step. */
export function TreatmentSwitch() {
  const { t } = useTranslation();
  const { session, commands } = useEditor();
  return (
    <Box mb={6}>
      <Segmented<Treatment>
        aria-label={t("editor.color.treatment")}
        value={session.recipe.color.treatment}
        onChange={value => commands.setControl("color.treatment", value, "set")}
        segments={[
          { value: "color", label: t("editor.color.color") },
          { value: "bw", label: t("editor.color.bw") },
        ]}
      />
    </Box>
  );
}
