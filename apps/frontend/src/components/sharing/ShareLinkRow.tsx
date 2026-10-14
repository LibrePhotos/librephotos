import { ActionIcon, Group, TextInput } from "@mantine/core";
import { IconCopy as CopyIcon, IconLink as LinkIcon, type TablerIcon } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../../util/util";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  label: string;
  /** What the link does, under its label. */
  description?: string;
  /** Empty while the server has not made the album's slug yet. */
  link: string;
  copyLabel: string;
  openLabel: string;
  /** The Open button's icon: the link icon unless the row opens something else (a slideshow). */
  openIcon?: TablerIcon;
}>;

/**
 * One labelled, read-only link of a public album with its Copy and Open buttons: the album link
 * and the slideshow link of the share dialog. While the slug is being made both buttons say so.
 */
export function ShareLinkRow({ label, description, link, copyLabel, openLabel, openIcon: OpenIcon = LinkIcon }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const noLinkYet = !link && t("sharing.generating");

  const copy = () => {
    if (!link) return;
    copyToClipboard(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const open = () => {
    if (link) window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    // nowrap: on a phone the open-link button dropped onto a line of its own.
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <TextInput
        flex={1}
        miw={0}
        label={label}
        description={description}
        value={link || t("sharing.generating")}
        readOnly
        leftSection={<LinkIcon size={16} />}
      />
      <DisabledReason
        label={copied ? t("sharing.copied") : copyLabel}
        opened={copied ? true : undefined}
        reason={noLinkYet}
      >
        <ActionIcon variant="light" size="lg" aria-label={copyLabel} onClick={copy}>
          <CopyIcon size={18} />
        </ActionIcon>
      </DisabledReason>
      <DisabledReason label={openLabel} reason={noLinkYet}>
        <ActionIcon variant="light" size="lg" aria-label={openLabel} onClick={open}>
          <OpenIcon size={18} />
        </ActionIcon>
      </DisabledReason>
    </Group>
  );
}
