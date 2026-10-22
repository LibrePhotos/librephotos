import type { Photo } from "@librephotos/api-client";
import { Anchor } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconHelpCircle as HelpCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { DateRulesTestModal } from "./DateRulesTestModal";
import classes from "./TimestampItem.module.css";

type Props = Readonly<{ photo: Pick<Photo, "id" | "owner"> }>;

/**
 * "Why this date?" under the date in the info panel (#2272): which of the owner's date rules dates
 * the photo. Only for the owner, whose rules they are.
 */
export function WhyThisDate({ photo }: Props) {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const [opened, { open, close }] = useDisclosure(false);
  if (userId === null || photo.owner.id !== userId) return null;
  return (
    <>
      <Anchor component="button" type="button" size="xs" onClick={open} className={classes.inlineLink}>
        <HelpCircle size={14} aria-hidden />
        {t("daterules.why")}
      </Anchor>
      <DateRulesTestModal opened={opened} onClose={close} photoId={photo.id} />
    </>
  );
}
