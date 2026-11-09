import { Anchor } from "@mantine/core";
import { IconChevronRight, IconFaceId } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFacesReviewCountQuery } from "../../api_client/faces/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { FACES_SEARCH_DEFAULTS } from "../facedashboard/facesTab";
import classes from "./FacesReviewLink.module.css";

/** Above this the number reads "999+": a backlog that size needs no exact count. */
const MAX_SHOWN = 999;

/**
 * The People page's way to the face dashboard, in the line under its title: "25 faces to review ›"
 * in the accent colour while suggestions wait, a quiet "Review faces ›" when none do (or while the
 * count loads). It never goes away: the dashboard is also where wrong labels and deleted faces are
 * fixed. It opens the Suggested tab, which lists exactly the faces it counts.
 */
export function FacesReviewLink({ group }: Readonly<{ group?: number }>) {
  const { t, i18n } = useTranslation();
  const { data: count = 0 } = useFacesReviewCountQuery({
    method: FACES_SEARCH_DEFAULTS.method,
    minConfidence: FACES_SEARCH_DEFAULTS.minConfidence,
    group,
  });
  const waiting = count > 0;
  const shown = count > MAX_SHOWN ? `${new Intl.NumberFormat(i18n.language).format(MAX_SHOWN)}+` : count;
  return (
    <Anchor
      // A router link, so Ctrl/Cmd-click opens a new tab
      renderRoot={props => (
        <Link {...props} to="/faces" search={{ ...FACES_SEARCH_DEFAULTS, tab: "inferred", group }} />
      )}
      className={classes.link}
      data-waiting={waiting || undefined}
    >
      <IconFaceId size={ICON_SIZE.inline} aria-hidden />
      {waiting ? t("personalbum.facestoreview", { count, shown }) : t("personalbum.reviewfaces")}
      <IconChevronRight size={14} aria-hidden />
    </Anchor>
  );
}
