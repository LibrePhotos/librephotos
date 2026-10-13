import { Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCloudUpload, IconFileX, IconFolderOff } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./UploadDropOverlay.module.css";

/** What dropping the dragged files would do. */
export type DropVerdict = "accept" | "add" | "reject" | "no_scan_directory";

const TONE: Record<DropVerdict, "blue" | "red" | "gray"> = {
  accept: "blue",
  add: "blue",
  reject: "red",
  no_scan_directory: "gray",
};

function useVerdictText(verdict: DropVerdict): { title: string; text: string } {
  const { t } = useTranslation();
  switch (verdict) {
    case "accept":
      return { title: t("upload.drop.accept_title"), text: t("upload.drop.accept_text") };
    case "add":
      return { title: t("upload.drop.add_title"), text: t("upload.drop.add_text") };
    case "reject":
      return { title: t("upload.drop.reject_title"), text: t("upload.drop.reject_text") };
    case "no_scan_directory":
      return { title: t("upload.drop.no_scan_directory_title"), text: t("upload.drop.no_scan_directory_text") };
  }
}

function VerdictIcon({ verdict }: { verdict: DropVerdict }) {
  if (verdict === "reject") return <IconFileX size={40} stroke={1.5} />;
  if (verdict === "no_scan_directory") return <IconFolderOff size={40} stroke={1.5} />;
  return <IconCloudUpload size={40} stroke={1.5} />;
}

/**
 * Full-window feedback while files are dragged over the app. Decorative for
 * assistive tech: the progress card announces what the drop started.
 */
export function UploadDropOverlay({ verdict }: { verdict: DropVerdict }) {
  const { title, text } = useVerdictText(verdict);
  const tone = TONE[verdict];
  return (
    <div className={classes.overlay} data-tone={tone} data-testid="upload-drop-overlay" aria-hidden>
      <Paper shadow="xl" radius="lg" p="xl" withBorder className={classes.card}>
        <Stack align="center" gap="sm">
          <ThemeIcon size={72} radius="xl" variant="light" color={tone}>
            <VerdictIcon verdict={verdict} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            {title}
          </Text>
          <Text size="sm" c="dimmed">
            {text}
          </Text>
        </Stack>
      </Paper>
    </div>
  );
}
