import {
  ActionIcon,
  Button,
  CopyButton,
  FocusTrap,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCheck as CheckIcon, IconCopy as CopyIcon, IconRefresh as RefreshIcon } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhotoShareMutation } from "../../api_client/photos/hooks";
import { shareAddress } from "../../api_client/urls";
import { DIALOG_SIZE } from "../modals/dialogSize";
import { ConfirmPopover } from "./ConfirmPopover";

type Props = {
  /** The photo to share; the dialog is open while this is set. */
  photoId: string | null;
  onClose: () => void;
};

/**
 * The link as the dialog knows it: being made, not made, or shown. A shown link stays while it is
 * replaced and after a replace fails, since recipients can still open it; only a replace that went
 * through swaps it.
 */
type LinkState =
  | { status: "creating" }
  | { status: "failed" }
  | { status: "shown"; url: string; replace: "idle" | "running" | "failed" };

/** Create (or show) a photo's share link, with copy, replace and revoke.
 *
 * The link is shown rather than copied straight away: a clipboard write made
 * after an awaited request has lost the user's click, and Safari refuses it.
 * The copy button below writes during its own click, so it works everywhere.
 */
export function PhotoShareLinkModal({ photoId, onClose }: Readonly<Props>) {
  const { t } = useTranslation();
  return (
    <Modal size={DIALOG_SIZE.sm} opened={!!photoId} onClose={onClose} title={t("sharing.photoLink")}>
      {/* No focus ring at open: nothing is focused until Tab */}
      <FocusTrap.InitialFocus />
      {/* One body per opening, so its link state starts over for every photo. */}
      {photoId && <ShareLinkBody key={photoId} photoId={photoId} onClose={onClose} />}
    </Modal>
  );
}

function ShareLinkBody({ photoId, onClose }: Readonly<{ photoId: string; onClose: () => void }>) {
  const { t } = useTranslation();
  const { mutate, mutateAsync } = usePhotoShareMutation();
  const [link, setLink] = useState<LinkState>({ status: "creating" });
  const requested = useRef(false);

  useEffect(() => {
    // One request per opening: StrictMode runs this effect twice, and two "enable" requests for
    // a photo without a link could race to make two links.
    if (requested.current) return;
    requested.current = true;
    mutateAsync({ photoId, action: "enable" }).then(
      share => setLink(share.url ? { status: "shown", url: share.url, replace: "idle" } : { status: "failed" }),
      () => setLink({ status: "failed" })
    );
  }, [mutateAsync, photoId]);

  const replace = async (url: string) => {
    setLink({ status: "shown", url, replace: "running" });
    try {
      const share = await mutateAsync({ photoId, action: "rotate" });
      setLink({ status: "shown", url: share.url ?? url, replace: share.url ? "idle" : "failed" });
    } catch {
      setLink({ status: "shown", url, replace: "failed" });
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {t("sharing.photoLinkExplanation")}
      </Text>
      {link.status === "creating" && (
        <Group justify="center">
          <Loader size="sm" />
        </Group>
      )}
      {link.status === "failed" && (
        <Text size="sm" c="red">
          {t("sharing.photoLinkFailed")}
        </Text>
      )}
      {link.status === "shown" && (
        <ShownLink
          url={`${shareAddress}${link.url}`}
          replace={link.replace}
          onReplace={() => void replace(link.url)}
          onRevoke={() => mutate({ photoId, action: "disable" }, { onSuccess: onClose })}
        />
      )}
    </Stack>
  );
}

type ShownLinkProps = Readonly<{
  url: string;
  replace: "idle" | "running" | "failed";
  onReplace: () => void;
  onRevoke: () => void;
}>;

function ShownLink({ url, replace, onReplace, onRevoke }: ShownLinkProps) {
  const { t } = useTranslation();
  return (
    <>
      <Group gap="xs" wrap="nowrap">
        <TextInput readOnly value={url} style={{ flexGrow: 1 }} onFocus={e => e.currentTarget.select()} />
        <CopyButton value={url}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "teal" : "gray"}
                onClick={copy}
                aria-label={t("sharing.copyLink")}
              >
                {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      {replace === "failed" && (
        <Text size="sm" c="red">
          {t("sharing.rotateLinkFailed")}
        </Text>
      )}
      {/* Both end the link the recipients already have, for good. */}
      <Group justify="flex-end" gap="xs">
        <ConfirmPopover
          message={t("sharing.rotateLinkConfirm")}
          confirmLabel={t("sharing.rotateLink")}
          onConfirm={onReplace}
        >
          <Button variant="subtle" leftSection={<RefreshIcon size={16} />} loading={replace === "running"}>
            {t("sharing.rotateLink")}
          </Button>
        </ConfirmPopover>
        <ConfirmPopover
          message={t("sharing.revokeLinkConfirm")}
          confirmLabel={t("sharing.revokeLink")}
          color="red"
          onConfirm={onRevoke}
        >
          <Button variant="subtle" color="red">
            {t("sharing.revokeLink")}
          </Button>
        </ConfirmPopover>
      </Group>
    </>
  );
}
