import { Card, Stack, Switch, Title } from "@mantine/core";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { SectionLink } from "./SettingsSection";
import type { UserSettingsCardProps } from "./userSettingsCard";

type LlmSwitch = "enabled" | "add_person" | "add_location";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One switch of the stored caption context (llm_settings, which holds whatever a client saved).
 * Each switch is read on its own, so a bad value under another key does not turn it off.
 */
function llmSwitchOf(settings: unknown, key: LlmSwitch): boolean | undefined {
  const value = isRecord(settings) ? settings[key] : undefined;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The stored caption context with one switch changed. The other keys keep their values and their
 * order, so switching back gives the saved JSON again and the "Save changes?" prompt closes.
 */
function withLlmSwitch(settings: unknown, key: LlmSwitch, value: boolean): Record<string, unknown> {
  return { ...(isRecord(settings) ? settings : {}), [key]: value };
}

export function CaptionContextCard({ user, onChange }: UserSettingsCardProps) {
  const { t } = useTranslation();
  const llmEnabled = llmSwitchOf(user.llm_settings, "enabled");
  const setSwitch = (key: LlmSwitch, value: boolean) =>
    onChange({ llm_settings: withLlmSwitch(user.llm_settings, key, value) });

  return (
    <Card shadow="md">
      <Stack>
        <Title order={4}>
          <Trans i18nKey="settings.captioncontext" />
          <SectionLink />
        </Title>
        <Switch
          label={t("settings.captioncontextenable")}
          checked={llmEnabled}
          onChange={event => setSwitch("enabled", event.currentTarget.checked)}
        />
        <Switch
          label={t("settings.addperson")}
          checked={llmSwitchOf(user.llm_settings, "add_person")}
          disabled={!llmEnabled}
          onChange={event => setSwitch("add_person", event.currentTarget.checked)}
        />
        <Switch
          label={t("settings.addlocation")}
          checked={llmSwitchOf(user.llm_settings, "add_location")}
          disabled={!llmEnabled}
          onChange={event => setSwitch("add_location", event.currentTarget.checked)}
        />
      </Stack>
    </Card>
  );
}
