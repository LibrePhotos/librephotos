import { ActionIcon, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle as InfoCircle } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchImageTagQuery, useUpdateNotice } from "../../api_client/server";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { ADMIN_SECTIONS } from "../settings/sectionIds";
import { useWhatsNew } from "../whatsnew/whatsNewContext";
import classes from "./SideMenuNarrow.module.css";

/**
 * The sidebar's `Version: <tag>` line, with the commit in its tooltip. While a newer release is out
 * (#2311), admins see a blue dot after it and "Update available: 1.5.0"; the line then opens the
 * Update available card on the Admin page. Otherwise the line opens What's new (#2305).
 */
export function VersionItem({ iconColor }: Readonly<{ iconColor: string }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: imageInfos } = useFetchImageTagQuery();
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const update = useUpdateNotice(user?.is_superuser === true);
  const whatsNew = useWhatsNew();
  const version = imageInfos?.image_tag || "dev";
  const content = (
    <>
      <ActionIcon component="span" className={classes.link_icon} variant="transparent" color={iconColor}>
        <InfoCircle />
      </ActionIcon>
      <Text className={classes.link_text} size="sm">
        {t("version", { version })}
      </Text>
    </>
  );

  if (!update) {
    // Opens What's new (#2305), the highlights of the version it names.
    return (
      <Tooltip label={t("sidemenu.backendversion", { hash: imageInfos?.git_hash })} disabled={!imageInfos?.git_hash}>
        <button
          type="button"
          className={`${classes.link} ${classes.link_button}`}
          aria-label={t("whatsnew.versionlabel", { version })}
          onClick={() => whatsNew.open()}
        >
          {content}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={t("updates.sidebar", { version: update.latest })}>
      <a
        className={classes.link}
        href={`/admin#${ADMIN_SECTIONS.update}`}
        aria-label={t("updates.versionlabel", { version })}
        onClick={event => {
          // Let the browser open Ctrl/Cmd/Shift-clicks in a new tab or window.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return;
          }
          event.preventDefault();
          void navigate({ to: "/admin", hash: ADMIN_SECTIONS.update });
        }}
      >
        {content}
        <span className={classes.update_dot} aria-hidden />
      </a>
    </Tooltip>
  );
}
