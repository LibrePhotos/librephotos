import { Alert, Radio, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

/** What happens to a user's photos outside a new scan directory (#2036). */
export type PhotosOutsideChoice = "keep" | "trash";

type Props = Readonly<{
  username: string;
  /** Null while the count loads. */
  outsideCount: number | null;
  choice: PhotosOutsideChoice;
  onChoiceChange: (choice: PhotosOutsideChoice) => void;
}>;

const isChoice = (value: string): value is PhotosOutsideChoice => value === "keep" || value === "trash";

/**
 * Under the scan directory picker once the admin picked another folder (#2036): how many of the
 * user's photos the new folder leaves outside, and whether they stay (the default, as before) or
 * go to the user's trash. Nothing changes owner; files on disk are never touched.
 */
export function ScanDirectoryChangeNotice({ username, outsideCount, choice, onChoiceChange }: Props) {
  const { t } = useTranslation();
  if (outsideCount === null) {
    return (
      <Alert color="orange" variant="light" mt="sm" icon={<IconAlertTriangle size={18} />}>
        <Text size="sm">{t("scandirectorychange.counting", { username })}</Text>
      </Alert>
    );
  }
  if (outsideCount === 0) {
    return (
      <Alert color="blue" variant="light" mt="sm" icon={<IconInfoCircle size={18} />}>
        <Text size="sm">{t("scandirectorychange.nothingoutside", { username })}</Text>
      </Alert>
    );
  }
  const titleId = "scan-directory-change-title";
  return (
    <Alert
      color="orange"
      variant="light"
      mt="sm"
      icon={<IconAlertTriangle size={18} />}
      title={<span id={titleId}>{t("scandirectorychange.title", { count: outsideCount, username })}</span>}
    >
      <Stack gap="xs">
        <Text size="sm">{t("scandirectorychange.question")}</Text>
        <Radio.Group
          value={choice}
          onChange={value => {
            if (isChoice(value)) onChoiceChange(value);
          }}
          aria-labelledby={titleId}
        >
          <Stack gap={6}>
            <Radio value="keep" label={t("scandirectorychange.keep", { username })} />
            <Radio
              value="trash"
              label={t("scandirectorychange.trash", { username })}
              description={t("scandirectorychange.trashdescription")}
            />
          </Stack>
        </Radio.Group>
        <Text size="xs" c="dimmed">
          {t("scandirectorychange.otheruser")}
        </Text>
      </Stack>
    </Alert>
  );
}
