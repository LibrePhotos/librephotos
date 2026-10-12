import { Box, Button, ButtonGroup, Checkbox, Group, Menu, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

type DetectOptions = {
  detect_exact_copies: boolean;
  detect_visual_duplicates: boolean;
  visual_threshold: number;
  clear_pending: boolean;
};

export function DetectDuplicatesMenu({
  isPhone,
  detectOptions,
  setDetectOptions,
  onDetect,
  isDetecting,
}: {
  isPhone: boolean;
  detectOptions: DetectOptions;
  setDetectOptions: Dispatch<SetStateAction<DetectOptions>>;
  onDetect: () => void;
  isDetecting: boolean;
}) {
  const { t } = useTranslation();
  // Stacked on phones: side by side the two buttons are wider than the screen
  return (
    <Group gap="xs" w={isPhone ? "100%" : undefined}>
      <ButtonGroup orientation={isPhone ? "vertical" : "horizontal"} w={isPhone ? "100%" : undefined}>
        <Menu shadow="md" width={300}>
          <Menu.Target>
            <Button variant="outline" size="sm" fullWidth={isPhone} rightSection={<IconChevronDown size={14} />}>
              {t("duplicates.detectOptions")}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{t("duplicates.whatToDetect")}</Menu.Label>
            <Box px="xs" py={4}>
              <Stack gap="xs">
                <Checkbox
                  size="sm"
                  checked={detectOptions.detect_exact_copies}
                  onChange={e => setDetectOptions(o => ({ ...o, detect_exact_copies: e.currentTarget.checked }))}
                  label={t("duplicates.detectExactCopies")}
                />
                <Checkbox
                  size="sm"
                  checked={detectOptions.detect_visual_duplicates}
                  onChange={e => setDetectOptions(o => ({ ...o, detect_visual_duplicates: e.currentTarget.checked }))}
                  label={t("duplicates.detectVisualDuplicates")}
                />
                {detectOptions.detect_visual_duplicates && (
                  <Box pl="md">
                    <Text size="xs" c="dimmed" mb={4}>
                      {t("duplicates.visualSensitivity")}
                    </Text>
                    <SegmentedControl
                      size="xs"
                      value={
                        detectOptions.visual_threshold === 1
                          ? "strict"
                          : detectOptions.visual_threshold === 5
                            ? "loose"
                            : "normal"
                      }
                      onChange={v =>
                        setDetectOptions(o => ({
                          ...o,
                          visual_threshold: v === "strict" ? 1 : v === "loose" ? 5 : 3,
                        }))
                      }
                      data={[
                        { value: "strict", label: t("settings.sensitivity.strict") },
                        { value: "normal", label: t("settings.sensitivity.normal") },
                        { value: "loose", label: t("settings.sensitivity.loose") },
                      ]}
                    />
                  </Box>
                )}
              </Stack>
            </Box>
            <Menu.Divider />
            <Menu.Label>{t("duplicates.optionslabel")}</Menu.Label>
            <Box px="xs" py={4}>
              <Checkbox
                size="sm"
                checked={detectOptions.clear_pending}
                onChange={e => setDetectOptions(o => ({ ...o, clear_pending: e.currentTarget.checked }))}
                label={
                  <Stack gap={0}>
                    <Text size="sm">{t("duplicates.clearPending")}</Text>
                    <Text size="xs" c="dimmed">
                      {t("duplicates.clearPendingDesc")}
                    </Text>
                  </Stack>
                }
              />
            </Box>
          </Menu.Dropdown>
        </Menu>
        <Button
          size="sm"
          fullWidth={isPhone}
          leftSection={<IconRefresh size={16} />}
          onClick={onDetect}
          loading={isDetecting}
        >
          {t("duplicates.detect")}
        </Button>
      </ButtonGroup>
    </Group>
  );
}
