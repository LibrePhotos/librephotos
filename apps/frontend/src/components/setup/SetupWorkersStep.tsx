import { Button, Group, Stack } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { ParallelWorkersSetting } from "../settings/ParallelWorkersSetting";

export function SetupWorkersStep({ onDone, busy }: Readonly<{ onDone: () => void; busy: boolean }>) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <ParallelWorkersSetting showRunning={false} />
      <Group grow>
        <Button onClick={onDone} disabled={busy}>
          {t("continue")}
        </Button>
      </Group>
    </Stack>
  );
}
