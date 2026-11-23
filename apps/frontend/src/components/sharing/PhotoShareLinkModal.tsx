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
import { isLinkExpired, linkExpiryCaption } from "./linkExpiry";
import { LinkExpirySetting } from "./LinkExpirySetting";
import { QrLinkButton } from "./QrLinkButton";

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
  | { status: "shown"; url: string; expiresAt: string; replace: "idle" | "running" | "failed" };

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

function useLatestExpirySave(save: (expiresAt: string) => Promise<unknown>) {
  const [failed, setFailed] = useState(false);
  const wanted = useRef<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const request = (expiresAt: string) => {
    wanted.current = expiresAt;
    setFailed(false);
    queue.current = queue.current.then(async () => {
      if (wanted.current !== expiresAt) return;
      try {
        await save(expiresAt);
      } catch {
        if (wanted.current === expiresAt) setFailed(true);
      }
    });
  };

  return { request, failed };
}

function ShareLinkBody({ photoId, onClose }: Readonly<{ photoId: string; onClose: () => void }>) {
  const { t } = useTranslation();
  const { mutate, mutateAsync } = usePhotoShareMutation();
  const [link, setLink] = useState<LinkState>({ status: "creating" });
  const requested = useRef(false);
  const expirySave = useLatestExpirySave(expiresAt =>
    mutateAsync({ photoId, action: "enable", expiresAt: expiresAt || null })
  );

  useEffect(() => {
    // One request per opening: StrictMode runs this effect twice, and two "enable" requests for
    // a photo without a link could race to make two links.
    if (requested.current) return;
    requested.current = true;
    mutateAsync({ photoId, action: "enable" }).then(
      share =>
        setLink(
          share.url
            ? { status: "shown", url: share.url, expiresAt: share.expires_at ?? "", replace: "idle" }
            : { status: "failed" }
        ),
      () => setLink({ status: "failed" })
    );
  }, [mutateAsync, photoId]);

  const replace = async (url: string, expiresAt: string) => {
    setLink({ status: "shown", url, expiresAt, replace: "running" });
    try {
      const share = await mutateAsync({ photoId, action: "rotate" });
      setLink({
        status: "shown",
        url: share.url ?? url,
        expiresAt,
        replace: share.url ? "idle" : "failed",
      });
    } catch {
      setLink({ status: "shown", url, expiresAt, replace: "failed" });
    }
  };

  const setExpiry = (state: Extract<LinkState, { status: "shown" }>, expiresAt: string) => {
    setLink({ ...state, expiresAt });
    expirySave.request(expiresAt);
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
          expiresAt={link.expiresAt}
          replace={link.replace}
          expirySaveFailed={expirySave.failed}
          onReplace={() => void replace(link.url, link.expiresAt)}
          onExpiryChange={expiresAt => setExpiry(link, expiresAt)}
          onRevoke={() => mutate({ photoId, action: "disable" }, { onSuccess: onClose })}
        />
      )}
    </Stack>
  );
}

type ShownLinkProps = Readonly<{
  url: string;
  expiresAt: string;
  replace: "idle" | "running" | "failed";
  expirySaveFailed: boolean;
  onReplace: () => void;
  onExpiryChange: (expiresAt: string) => void;
  onRevoke: () => void;
}>;

function ShownLink({ url, expiresAt, replace, expirySaveFailed, onReplace, onExpiryChange, onRevoke }: ShownLinkProps) {
  const { t } = useTranslation();
  const expired = isLinkExpired(expiresAt);
  return (
    <>
      <Group gap="xs" wrap="nowrap">
        <TextInput readOnly value={url} style={{ flexGrow: 1 }} onFocus={e => e.currentTarget.select()} />
        <CopyButton value={url}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? t("sharing.copied") : t("sharing.copyLink")} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "green" : "gray"}
                onClick={copy}
                aria-label={t("sharing.copyLink")}
              >
                {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
        <QrLinkButton url={url} position="right-start" warning={expired ? t("sharing.qrCodeExpired") : null} />
      </Group>
      {expired && (
        <Text size="sm" c="orange">
          {t("sharing.linkExpiredHint", { expired: linkExpiryCaption(t, expiresAt) })}
        </Text>
      )}
      {replace === "failed" && (
        <Text size="sm" c="red">
          {t("sharing.rotateLinkFailed")}
        </Text>
      )}
      <LinkExpirySetting value={expiresAt} onChange={onExpiryChange} />
      {!expired && (
        <Text size="sm" c="dimmed">
          {expiresAt ? linkExpiryCaption(t, expiresAt) : t("sharing.neverExpires")}
        </Text>
      )}
      {expirySaveFailed && (
        <Text size="sm" c="red">
          {t("sharing.expirySaveFailed")}
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
