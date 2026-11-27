import { Box, Button, Checkbox, Flex, Group, Menu, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";

type DetectOptions = {
  detect_exact_copies: boolean;
  detect_visual_duplicates: boolean;
  visual_threshold: number;
  clear_pending: boolean;
};

type DetectSwitch = "detect_exact_copies" | "detect_visual_duplicates" | "clear_pending";

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
  const toggle = (option: DetectSwitch) => (event: ChangeEvent<HTMLInputElement>) => {
    const { checked } = event.currentTarget;
    setDetectOptions(options => ({ ...options, [option]: checked }));
  };
  // Stacked on phones: side by side the two buttons are wider than the screen
  return (
    <Group gap="xs" w={isPhone ? "100%" : undefined}>
      <Flex direction={isPhone ? "column" : "row"} gap={4} w={isPhone ? "100%" : undefined}>
        <Menu shadow="md" width={300}>
          <Menu.Target>
            <Button
              {...toolbarLook()}
              h={TOOLBAR_CONTROL_HEIGHT}
              fullWidth={isPhone}
              rightSection={<IconChevronDown size={14} />}
            >
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
                  onChange={toggle("detect_exact_copies")}
                  label={t("duplicates.detectExactCopies")}
                />
                <Checkbox
                  size="sm"
                  checked={detectOptions.detect_visual_duplicates}
                  onChange={toggle("detect_visual_duplicates")}
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
                onChange={toggle("clear_pending")}
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
          variant="light"
          h={TOOLBAR_CONTROL_HEIGHT}
          fullWidth={isPhone}
          leftSection={<IconRefresh size={16} />}
          onClick={onDetect}
          loading={isDetecting}
        >
          {t("duplicates.detect")}
        </Button>
      </Flex>
    </Group>
  );
}
