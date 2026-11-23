import { Stack } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { CONTROL_LABELS } from "../controls/controlLabels";
import { EditSlider } from "../controls/EditSlider";
import { PanelSection } from "../controls/PanelSection";
import { anyChanged } from "../controls/resetControls";
import { useEditor } from "../EditorContext";
import classes from "./AdvancedMode.module.css";
import { ADVANCED_SECTIONS, orderedSections, resetSection, type AdvancedSection } from "./advancedSections";

/** One section's content: its sliders, then its own component. */
function SectionBody({ section }: Readonly<{ section: AdvancedSection }>) {
  const { t } = useTranslation();
  const { Content, Top } = section;
  return (
    <Stack gap={4}>
      {Top && <Top />}
      {section.controls?.map(path => {
        const label = CONTROL_LABELS[path];
        return label ? <EditSlider key={path} path={path} label={t(label)} /> : null;
      })}
      {Content && <Content />}
    </Stack>
  );
}

/**
 * The advanced mode: the sections of ADVANCED_SECTIONS in their order, each collapsible with its
 * own Reset. The crop section is the crop tool: opening it shows the full frame.
 */
export function AdvancedMode() {
  const { t } = useTranslation();
  const { session, commands, cropActive, setCropActive } = useEditor();
  const recipe = session.recipe;
  return (
    <div className={classes.root}>
      {orderedSections(ADVANCED_SECTIONS).map(section => {
        if (section.shown && !section.shown(recipe)) return null;
        if (!section.title) return <SectionBody key={section.id} section={section} />;
        const changed = section.changed ? section.changed(recipe) : anyChanged(recipe, section.controls ?? []);
        return (
          <PanelSection
            key={section.id}
            title={t(section.title)}
            changed={changed}
            onReset={() => commands.apply("reset", resetSection(section, session.recipe))}
            defaultOpened={!section.collapsed}
            {...(section.cropTool ? { opened: cropActive, onToggle: setCropActive } : {})}
          >
            <SectionBody section={section} />
          </PanelSection>
        );
      })}
    </div>
  );
}
