import { ActionIcon, Indicator, Tooltip } from "@mantine/core";
import { IconUpload as Upload } from "@tabler/icons-react";
import React from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { useUpload } from "./upload";
import { UPLOAD_ACCEPT } from "./upload/uploadAccept";
import { useCanUpload } from "./upload/useCanUpload";

/**
 * The header's upload tile: opens the file picker. Dropped files are taken
 * anywhere in the app by `UploadDropTarget`, which also keeps a drop from
 * opening the file in the tab.
 */
export function ChunkedUploadButton() {
  const { t } = useTranslation();
  const availability = useCanUpload();
  const { start, isUploading } = useUpload();
  const ready = availability === "ready";

  const { getInputProps, open } = useDropzone({
    accept: UPLOAD_ACCEPT,
    noDrag: true,
    noClick: true,
    noKeyboard: true,
    preventDropOnDocument: false,
    onDrop: files => start(files),
    disabled: !ready,
  });

  if (availability === "off") {
    return null;
  }

  const uploadContent = (
    <div style={{ alignItems: "center", display: "flex" }}>
      <input {...getInputProps()} data-testid="upload-input" />
      {/* Same 30px tile and 1.1rem glyph as the colour scheme toggle beside it.
          A block Indicator gave the button a line box that lifted it ~2px. */}
      <Indicator processing disabled={!isUploading} color="blue" size={8} offset={3} style={{ display: "flex" }}>
        <ActionIcon
          color="gray"
          variant="light"
          size={30}
          onClick={ready ? open : undefined}
          disabled={!ready}
          style={!ready ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
          aria-label={t("upload.button")}
        >
          <Upload size="1.1rem" />
        </ActionIcon>
      </Indicator>
    </div>
  );

  if (!ready) {
    return <Tooltip label={t("toasts.scan_directory_required")}>{uploadContent}</Tooltip>;
  }

  return uploadContent;
}
