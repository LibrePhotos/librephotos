import { Button, Group, Tabs } from "@mantine/core";
import { IconAdjustments, IconCrop, IconFilters } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";
import { withDefaultGeometry } from "../controls/resetControls";
import { CropControls } from "../crop/CropControls";
import { useEditor } from "../EditorContext";
import { changesGeometry } from "../engine/recipe";
import { FiltersPanel } from "../filters/FiltersPanel";
import { AdjustPanel } from "./AdjustPanel";
import classes from "./SimpleMode.module.css";

type SimpleTab = "adjust" | "filters" | "crop";

/**
 * The simple mode: Adjust (nine plain sliders), Filters (looks with their strength) and Crop &
 * rotate. The crop tab is the crop tool: leaving it (another tab, Escape) puts the photo back
 * cropped.
 */
export function SimpleMode() {
  const { t } = useTranslation();
  const { session, commands, cropActive, setCropActive } = useEditor();
  const [tab, setTab] = useState<Exclude<SimpleTab, "crop">>("adjust");
  const shown: SimpleTab = cropActive ? "crop" : tab;
  const choose = (next: string | null) => {
    if (next === "crop") setCropActive(true);
    else if (next === "adjust" || next === "filters") {
      setCropActive(false);
      setTab(next);
    }
  };
  return (
    <Tabs value={shown} onChange={choose} classNames={{ root: classes.root, list: classes.list, panel: classes.panel }}>
      <Tabs.List grow>
        <Tabs.Tab value="adjust" leftSection={<IconAdjustments size={ICON_SIZE.inline} />}>
          {t("editor.simple.adjust")}
        </Tabs.Tab>
        <Tabs.Tab value="filters" leftSection={<IconFilters size={ICON_SIZE.inline} />}>
          {t("editor.simple.filters")}
        </Tabs.Tab>
        <Tabs.Tab value="crop" leftSection={<IconCrop size={ICON_SIZE.inline} />}>
          {t("editor.simple.crop")}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="adjust">
        <AdjustPanel />
      </Tabs.Panel>
      <Tabs.Panel value="filters">
        <FiltersPanel />
      </Tabs.Panel>
      <Tabs.Panel value="crop">
        <CropControls />
        {changesGeometry(session.recipe) && (
          <Group justify="flex-end" mt="md">
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => commands.apply("reset", withDefaultGeometry(session.recipe))}
            >
              {t("editor.crop.reset")}
            </Button>
          </Group>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}
