import type { User } from "@librephotos/api-client";
import { Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { LicenseSelect } from "../rights/LicenseSelect";
import { asLicense } from "../rights/photoLicenses";
import { ApplyRightsDefaultModal } from "./ApplyRightsDefaultModal";
import type { UserSettingsCardProps } from "./userSettingsCard";

type Props = UserSettingsCardProps & {
  /** The user as saved, whose default "Apply" sets. */
  saved: User;
};

/** The three fields of the default. */
const defaultFields = (user: User) => [user.default_license, user.default_creator, user.default_copyright];

/** Why "Apply" cannot run: changes not saved yet, or no default saved; false when it can. */
function applyBlockedReason(
  user: User,
  saved: User,
  t: (key: "rights.default.noDefault" | "rights.default.unsaved") => string
) {
  if (JSON.stringify(defaultFields(user)) !== JSON.stringify(defaultFields(saved))) return t("rights.default.unsaved");
  if (!defaultFields(saved).some(Boolean)) return t("rights.default.noDefault");
  return false;
}

/**
 * Settings > Metadata, "Rights for your photos" (#425): the creator, copyright notice and license a
 * photo gets when its file states none. New photos get them when they are scanned; "Apply" sets them
 * on the photos already in the library, after asking.
 */
export function RightsDefaultCard({ user, saved, onChange }: Props) {
  const { t } = useTranslation();
  const [applyOpened, { open: openApply, close: closeApply }] = useDisclosure(false);
  return (
    <Card shadow="md">
      <Title order={4} mb={4}>
        {t("rights.default.title")}
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        {t("rights.default.description")}
      </Text>
      <Stack gap="sm">
        <TextInput
          label={t("rights.creator")}
          value={user.default_creator ?? ""}
          maxLength={200}
          onChange={event => onChange({ default_creator: event.currentTarget.value })}
        />
        <TextInput
          label={t("rights.default.copyright")}
          description={t("rights.bulk.yearHint")}
          placeholder={t("rights.default.copyrightPlaceholder")}
          value={user.default_copyright ?? ""}
          onChange={event => onChange({ default_copyright: event.currentTarget.value })}
        />
        <LicenseSelect
          value={asLicense(user.default_license)}
          onChange={value => onChange({ default_license: value ?? "" })}
        />
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Text size="xs" c="dimmed" maw={420}>
            {t("rights.default.newPhotos")}
          </Text>
          <DisabledReason reason={applyBlockedReason(user, saved, t)}>
            <Button variant="default" onClick={openApply}>
              {t("rights.default.apply")}
            </Button>
          </DisabledReason>
        </Group>
      </Stack>
      {applyOpened && <ApplyRightsDefaultModal opened onClose={closeApply} />}
    </Card>
  );
}
