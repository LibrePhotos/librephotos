import { ApiError } from "@librephotos/api-client";
import { Alert, Button, Modal, Stack, Text } from "@mantine/core";
import { useMediaQuery, useViewportSize } from "@mantine/hooks";
import { IconAlertCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useRawPhotoMetadataQuery } from "../../api_client/photos/hooks/useRawPhotoMetadataQuery";
import { PageLoader } from "../common/PageLoader";
import { MetadataFiles } from "./MetadataFiles";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The photo's UUID. */
  photoId: string;
  /** The main file's name, for the title while the tags load. */
  fileName: string;
}>;

// The tag table's height: the viewport less the modal's header, tabs, toolbar and footer.
const CHROME_DESKTOP = 330;
const CHROME_PHONE = 230;
const MIN_TABLE = 240;
const MAX_TABLE = 600;

function tableHeightFor(viewportHeight: number, isPhone: boolean): number {
  const available = viewportHeight - (isPhone ? CHROME_PHONE : CHROME_DESKTOP);
  return Math.max(MIN_TABLE, isPhone ? available : Math.min(MAX_TABLE, available));
}

function ReadError({ error, onRetry, retrying }: Readonly<{ error: Error; onRetry: () => void; retrying: boolean }>) {
  const { t } = useTranslation();
  const missing = error instanceof ApiError && error.serverCode === "file_missing";
  const message = (error instanceof ApiError && error.serverMessage) || t("toasts.requestfailed");
  return (
    <Alert
      color="red"
      icon={<IconAlertCircle size={18} />}
      title={missing ? t("allmetadata.filemissingtitle") : t("allmetadata.readfailedtitle")}
      role="alert"
    >
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{message}</Text>
        <Button size="xs" variant="light" color="red" onClick={onRetry} loading={retrying}>
          {t("allmetadata.retry")}
        </Button>
      </Stack>
    </Alert>
  );
}

/**
 * The owner's "All metadata" (#2277): every tag ExifTool reads in the photo's file and each of
 * its sidecars, read when the dialog opens and never stored.
 */
export function AllMetadataModal({ opened, onClose, photoId, fileName }: Props) {
  const { t } = useTranslation();
  const isPhone = useMediaQuery("(max-width: 36em)") ?? false;
  const { height: viewportHeight } = useViewportSize();
  const query = useRawPhotoMetadataQuery(opened ? photoId : undefined);
  const sidecars = query.data ? query.data.files.length - 1 : 0;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      fullScreen={isPhone}
      title={
        <Text component="span" fw={600}>
          {t("allmetadata.title")}{" "}
          <Text component="span" size="sm" c="dimmed" fw={400}>
            {sidecars > 0 ? t("allmetadata.subtitle", { name: fileName, count: sidecars }) : fileName}
          </Text>
        </Text>
      }
    >
      <Stack gap="sm">
        {query.data && <MetadataFiles files={query.data.files} tableHeight={tableHeightFor(viewportHeight, isPhone)} />}
        {!query.data && query.error && (
          <ReadError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        )}
        {!query.data && !query.error && <PageLoader label={t("allmetadata.loading")} />}
        <Text size="xs" c="dimmed">
          {t("allmetadata.footer")}
        </Text>
      </Stack>
    </Modal>
  );
}
