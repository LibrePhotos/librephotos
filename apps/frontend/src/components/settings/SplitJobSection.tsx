import type { MantineColor } from "@mantine/core";
import { ActionIcon, Button, Divider, Grid, Group, Menu, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { TablerIcon } from "@tabler/icons-react";
import { IconChevronDown as ChevronDown } from "@tabler/icons-react";
import React from "react";
import { DisabledReason } from "../common/DisabledReason";
import { ConfirmModal } from "../modals/ConfirmModal";
import { ACTION_MIN_WIDTH } from "./libraryLayout";
import classes from "./SplitJobSection.module.css";

type SplitJobSectionProps = {
  /** The section's divider label. */
  heading: string;
  title: string;
  description: string;
  icon: TablerIcon;
  /** The main button: the photos the job has not covered yet. */
  runLabel: string;
  /** The chevron's menu item, and the chevron's accessible name: every photo again. */
  runAgainLabel: string;
  /** The question before every photo is done again; `color` as ConfirmModal's `confirmColor`. */
  confirm: { title: string; message: string; confirmLabel: string; color?: MantineColor };
  /** Why the buttons are off (a job is running, the feature is off). Undefined while they work. */
  disabledReason?: string;
  /** Start the job (a mutation's `mutate`); `onSettled` closes the question once the server has answered. */
  onRun: (fullScan: boolean, options?: { onSettled?: () => void }) => void;
  /** The start request is in flight. */
  loading: boolean;
};

/**
 * A Library page section whose job runs on the photos it has not covered yet, or, from the
 * chevron's menu and after a confirmation, on every photo again (Captions #2211, Things #2765).
 */
export function SplitJobSection({
  heading,
  title,
  description,
  icon: Icon,
  runLabel,
  runAgainLabel,
  confirm,
  disabledReason,
  onRun,
  loading,
}: SplitJobSectionProps) {
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  return (
    <>
      <Divider labelPosition="left" label={<Text fw="bold">{heading}</Text>} mt={20} />
      <Grid>
        <Grid.Col span={{ base: 12, sm: "auto" }}>
          <Stack gap={0}>
            <Text>{title}</Text>
            <Text fz="sm" c="dimmed">
              {description}
            </Text>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
          <Group wrap="nowrap" gap={0} justify="flex-end">
            <DisabledReason reason={disabledReason}>
              <Button
                onClick={() => onRun(false)}
                leftSection={<Icon />}
                variant="outline"
                className={classes.main}
                fullWidth
              >
                {runLabel}
              </Button>
            </DisabledReason>
            <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
              {/* Outside Menu.Target, so its click handler replaces the one that opens the menu. */}
              <DisabledReason reason={disabledReason}>
                <Menu.Target>
                  <ActionIcon variant="outline" size={36} aria-label={runAgainLabel} className={classes.toggle}>
                    <ChevronDown size="1rem" />
                  </ActionIcon>
                </Menu.Target>
              </DisabledReason>
              <Menu.Dropdown>
                <Menu.Item leftSection={<Icon size="1rem" />} onClick={openConfirm}>
                  {runAgainLabel}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Grid.Col>
      </Grid>
      {/* Next to the Menu, not in it: the dropdown unmounts when the item closes it. */}
      <ConfirmModal
        opened={confirmOpened}
        onClose={closeConfirm}
        onConfirm={() => onRun(true, { onSettled: closeConfirm })}
        loading={loading}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        confirmColor={confirm.color}
      />
    </>
  );
}
