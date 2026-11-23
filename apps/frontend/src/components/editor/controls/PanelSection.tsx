import { ActionIcon, Collapse, Group, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconRestore } from "@tabler/icons-react";
import React, { useId } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../../uiConstants";
import classes from "./PanelSection.module.css";
import { SectionOpenContext } from "./sectionOpen";

export type PanelSectionProps = Readonly<{
  title: string;
  /**
   * Resets what the section holds (one history step); its button shows only while there is
   * something to reset (`changed`).
   */
  onReset?: () => void;
  /** Whether anything in the section differs from its default. */
  changed?: boolean;
  /** Controlled open state (the crop section is the crop tool); left out, the section keeps its own. */
  opened?: boolean;
  onToggle?: (opened: boolean) => void;
  /** The open state of an uncontrolled section at first. */
  defaultOpened?: boolean;
  children: React.ReactNode;
}>;

/**
 * A collapsible section of the editor's panel: a heading that opens and closes it, a Reset for
 * what it holds when something there was changed, and its controls.
 */
export function PanelSection({
  title,
  onReset,
  changed = false,
  opened,
  onToggle,
  defaultOpened = true,
  children,
}: PanelSectionProps) {
  const { t } = useTranslation();
  const contentId = useId();
  const [ownOpened, own] = useDisclosure(defaultOpened);
  const isOpen = opened ?? ownOpened;
  const toggle = () => {
    if (isOpen) own.close();
    else own.open();
    onToggle?.(!isOpen);
  };
  const resetLabel = t("editor.section.reset", { section: title });
  return (
    <section className={classes.section}>
      <Group gap={4} wrap="nowrap" className={classes.header}>
        <UnstyledButton className={classes.toggle} onClick={toggle} aria-expanded={isOpen} aria-controls={contentId}>
          <IconChevronDown size={ICON_SIZE.inline} className={classes.chevron} data-open={isOpen || undefined} />
          <Text size="sm" fw={600} component="span">
            {title}
          </Text>
        </UnstyledButton>
        {onReset && changed && (
          <Tooltip label={resetLabel}>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={resetLabel} onClick={onReset}>
              <IconRestore size={ICON_SIZE.inline} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <Collapse expanded={isOpen} id={contentId}>
        <SectionOpenContext.Provider value={isOpen}>
          <div className={classes.content}>{children}</div>
        </SectionOpenContext.Provider>
      </Collapse>
    </section>
  );
}
