import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconInfoCircle as InfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { DateRulesTestModal } from "./DateRulesTestModal";

type Props = Readonly<{ photo: Pick<Photo, "id" | "owner"> }>;

/**
 * "Why this date?" beside the date's pencil in the info panel (#2272): an ⓘ that opens which of
 * the owner's date rules dates the photo. Only for the owner, whose rules they are.
 */
export function WhyThisDate({ photo }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const [opened, { open, close }] = useDisclosure(false);
  if (userId === null || photo.owner.id !== userId) return null;
  return (
    <>
      <Tooltip label={t("daterules.why")}>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t("daterules.why")} onClick={open}>
          <InfoCircle size={16} />
        </ActionIcon>
      </Tooltip>
      <DateRulesTestModal opened={opened} onClose={close} photoId={photo.id} />
    </>
  );
}
