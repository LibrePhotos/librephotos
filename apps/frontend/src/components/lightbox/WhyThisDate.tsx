import type { Photo } from "@librephotos/api-client";
import { ActionIcon, Stack, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconInfoCircle as InfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { DateRulesTestModal } from "./DateRulesTestModal";

type Props = Readonly<{ photo: Pick<Photo, "id" | "owner"> & Partial<Pick<Photo, "date_set_by_user">> }>;

/**
 * "Why this date?" right after the date in the info panel (#2272): an ⓘ that opens which of the
 * owner's date rules dates the photo. Only for the owner, whose rules they are. A date set by hand
 * wins over the rules (#2254): its hover says so ("Set by you"), in place of a line in the row.
 */
export function WhyThisDate({ photo }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const [opened, { open, close }] = useDisclosure(false);
  if (userId === null || photo.owner.id !== userId) return null;
  return (
    <>
      <Tooltip
        label={
          photo.date_set_by_user ? (
            <Stack gap={0}>
              <span>{t("daterules.why")}</span>
              <span>{t("lightbox.sidebar.datesetbyuser")}</span>
            </Stack>
          ) : (
            t("daterules.why")
          )
        }
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={t("daterules.why")}
          aria-description={photo.date_set_by_user ? t("lightbox.sidebar.datesetbyuser") : undefined}
          onClick={open}
        >
          <InfoCircle size={14} />
        </ActionIcon>
      </Tooltip>
      <DateRulesTestModal opened={opened} onClose={close} photoId={photo.id} />
    </>
  );
}
