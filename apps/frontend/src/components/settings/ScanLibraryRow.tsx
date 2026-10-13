import {
  ActionIcon,
  Button,
  Collapse,
  Grid,
  Group,
  List,
  Menu,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconChevronDown as ChevronDown,
  IconQuestionMark as QuestionMark,
  IconRefresh as Refresh,
} from "@tabler/icons-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { ACTION_MIN_WIDTH } from "./libraryLayout";

type ScanLibraryRowProps = {
  /** Why job buttons are off: a job is running. Undefined while the queue takes jobs. */
  busyReason?: string;
  /** No scan directory and not an admin: scanning has to wait for an admin. */
  scanBlocked: boolean;
  onScan: () => void;
  onRescan: () => void;
};

/** The Scan library row: its help, and the scan button with rescan in its menu. */
export function ScanLibraryRow({ busyReason, scanBlocked, onScan, onRescan }: ScanLibraryRowProps) {
  const [isScanHelpOpen, { toggle: toggleScanHelp }] = useDisclosure(false);
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme();
  const scanReason = busyReason ?? (scanBlocked ? t("toasts.scan_directory_required") : undefined);

  return (
    <Grid>
      <Grid.Col span={{ base: 12, sm: "auto" }}>
        <Stack gap={0}>
          <Group gap="xs">
            <Text>{t("settings.scanlibrary")}</Text>
            {/* The handler sits on the button, not the icon, so Enter and Space work too. */}
            <ActionIcon
              radius="xl"
              variant="light"
              size="xs"
              aria-label={t("settings.scanhelp")}
              aria-expanded={isScanHelpOpen}
              aria-controls="scan-library-help"
              onClick={toggleScanHelp}
            >
              <QuestionMark size={14} />
            </ActionIcon>
          </Group>
          <Text fz="sm" c="dimmed">
            {t("settings.scanphotosdescription")}
          </Text>
          {scanBlocked && (
            <Text fz="sm" c="orange">
              {t("toasts.scan_directory_required")}
            </Text>
          )}
          {/* In the description column, so the collapsed help adds no gap to the rows. */}
          <Collapse expanded={isScanHelpOpen} id="scan-library-help">
            <Stack gap={0} mt="xs">
              <Text>{t("settings.scanhelpheading")}</Text>
              <List>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item1" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item2" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item3" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item4" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item5" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item6" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item7" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item8" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item9" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item10" />
                  </Text>
                </List.Item>
                <List.Item>
                  <Text fz="sm" c="dimmed">
                    <Trans i18nKey="settings.scannextclouddescription.item11" />
                  </Text>
                </List.Item>
              </List>
            </Stack>
          </Collapse>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: "content" }} miw={ACTION_MIN_WIDTH}>
        <Group wrap="nowrap" gap={0} justify="flex-end">
          <DisabledReason reason={scanReason}>
            <Button
              onClick={onScan}
              leftSection={<Refresh />}
              variant="filled"
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              fullWidth
            >
              {t("settings.statusscanphotosfalse")}
            </Button>
          </DisabledReason>
          <Menu transitionProps={{ transition: "pop" }} position="bottom-end" withinPortal>
            {/* Outside Menu.Target, so its click handler replaces the one that opens the menu. */}
            <DisabledReason reason={scanReason}>
              <Menu.Target>
                <ActionIcon
                  variant="filled"
                  color="blue"
                  size={36}
                  aria-label={t("settings.statusrescanphotosfalse")}
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    border: 0,
                    borderLeft:
                      colorScheme === "dark" ? `1px solid ${theme.colors.dark[7]}` : `1px solid ${theme.white}`,
                  }}
                >
                  <ChevronDown size="1rem" />
                </ActionIcon>
              </Menu.Target>
            </DisabledReason>
            <Menu.Dropdown>
              <DisabledReason reason={scanReason} position="left">
                <Menu.Item leftSection={<Refresh size="1rem" />} onClick={onRescan}>
                  {t("settings.statusrescanphotosfalse")}
                </Menu.Item>
              </DisabledReason>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Grid.Col>
    </Grid>
  );
}
