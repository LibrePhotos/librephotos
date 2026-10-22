import { Alert, Button, Group, Loader, Text } from "@mantine/core";
import { IconCircleCheck, IconFaceIdError, IconScan } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { DetectFacesOutcome } from "../../api_client/faces";
import type { FaceDrawResult } from "./useFaceDrawing";

/**
 * What became of a box drawn around a face (#1117): the face is being looked for in it, or there
 * is none there, with the choice to keep the box as drawn or to draw again.
 */
export function DrawnFaceStatus({ result }: Readonly<{ result: FaceDrawResult }>) {
  const { t } = useTranslation();
  if (result.state === "finding") {
    return (
      <Alert mt="xs" color="blue" role="status" icon={<Loader size="xs" />}>
        <Text size="sm">{t("lightbox.addface.finding")}</Text>
      </Alert>
    );
  }
  if (result.state === "idle") return null;
  return (
    <Alert mt="xs" color="orange" icon={<IconFaceIdError />} title={t("lightbox.addface.notfoundtitle")}>
      <Text size="sm">{t("lightbox.addface.notfound")}</Text>
      <Group mt="xs" gap="xs">
        <Button size="xs" onClick={result.keepBox}>
          {t("lightbox.addface.keepbox")}
        </Button>
        <Button size="xs" variant="default" onClick={result.drawAgain}>
          {t("lightbox.addface.drawagain")}
        </Button>
      </Group>
    </Alert>
  );
}

type DetectProps = Readonly<{
  outcome: DetectFacesOutcome;
  /** Absent where a face cannot be drawn (a video). */
  onDrawFace?: () => void;
}>;

/**
 * What Detect faces again found on this photo (#1117), where its faces are listed: still looking,
 * new faces (marked New in the list), the same faces as before (with a way to draw the one it
 * missed), or a failed job.
 */
export function DetectFacesStatus({ outcome, onDrawFace }: DetectProps) {
  const { t } = useTranslation();
  const closable = { withCloseButton: true, closeButtonLabel: t("close"), onClose: outcome.dismiss };
  switch (outcome.state) {
    case "running":
      return (
        <Alert mt="xs" color="blue" role="status" icon={<Loader size="xs" />} title={t("lightbox.detectfaces.running")}>
          <Text size="sm">{t("lightbox.detectfaces.runninghint")}</Text>
        </Alert>
      );
    case "found":
      return (
        <Alert mt="xs" color="green" role="status" icon={<IconCircleCheck />} {...closable}>
          <Text size="sm">{t("lightbox.detectfaces.found", { count: outcome.newFaceIds.length })}</Text>
        </Alert>
      );
    case "none":
      return (
        <Alert
          mt="xs"
          color="orange"
          role="status"
          icon={<IconScan />}
          title={t("lightbox.detectfaces.nonetitle")}
          {...closable}
        >
          <Text size="sm">{t("lightbox.detectfaces.none")}</Text>
          {onDrawFace && (
            <Button mt="xs" size="xs" onClick={onDrawFace}>
              {t("lightbox.detectfaces.draw")}
            </Button>
          )}
        </Alert>
      );
    case "failed":
      return (
        <Alert mt="xs" color="red" role="status" icon={<IconFaceIdError />} {...closable}>
          <Text size="sm">{t("lightbox.detectfaces.failed")}</Text>
        </Alert>
      );
  }
}
