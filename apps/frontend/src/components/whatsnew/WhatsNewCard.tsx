import type { User } from "@librephotos/api-client";
import { Anchor, Box, Button, CloseButton, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconExternalLink as ExternalLink, IconSparkles as Sparkles } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useOpenUpgradeTaskCount } from "../../api_client/jobs/hooks/useUpgradeTasks";
import { useSaveLastSeenReleaseMutation } from "../../api_client/user/hooks/useSaveLastSeenReleaseMutation";
import { FOOTER_HEIGHT, LEFT_MENU_WIDTH } from "../../uiConstants";
import { NoticeCard } from "../common/NoticeCard";
import { ADMIN_SECTIONS } from "../settings/sectionIds";
import { selectUnseen } from "./selectUnseen";
import classes from "./WhatsNewCard.module.css";
import { WHATS_NEW_RELEASES, type WhatsNewRelease } from "./whatsNewReleases";

/** The card lists this many highlights; the dialog has them all. */
const MAX_CARD_HIGHLIGHTS = 4;

type WhatsNewCardProps = Readonly<{
  user: User;
  runningTag: string;
  /** Open the dialog on these releases (by tag). */
  onSeeWhatsNew: (releases: readonly string[]) => void;
}>;

/** For admins after an update: how many upgrade tasks are left, with a link to their card (#2322). */
function UpgradeTasksLine({ isAdmin }: Readonly<{ isAdmin: boolean }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const count = useOpenUpgradeTaskCount(isAdmin);
  if (count === 0) return null;
  return (
    <Text size="sm" c="orange">
      {t("whatsnew.upgradetasks", { count })}{" "}
      <Anchor
        component="button"
        type="button"
        size="sm"
        onClick={() => void navigate({ to: "/admin", hash: ADMIN_SECTIONS.upgrade })}
      >
        {t("whatsnew.openupgradetasks")}
      </Anchor>
    </Text>
  );
}

function Highlights({ releases }: Readonly<{ releases: readonly WhatsNewRelease[] }>) {
  const highlights = releases.flatMap(release => release.highlights).slice(0, MAX_CARD_HIGHLIGHTS);
  return (
    <Stack component="ul" gap={6} className={classes.list}>
      {highlights.map(highlight => (
        <li key={highlight.id}>
          <Text size="sm" fw={600}>
            {highlight.title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {highlight.body}
          </Text>
        </li>
      ))}
    </Stack>
  );
}

/**
 * The What's new card (#2305): after an update, a small card in a corner of the page with the
 * release's highlights, once per user. Closing it or opening the dialog remembers the release on the
 * server, so it does not come back on another browser. It never blocks the page and has no media;
 * only its close button closes it, so a stray Escape cannot dismiss it unseen.
 */
export function WhatsNewCard({ user, runningTag, onSeeWhatsNew }: WhatsNewCardProps) {
  const { t } = useTranslation();
  const isAdmin = user.is_superuser === true;
  const decision = selectUnseen(WHATS_NEW_RELEASES, {
    runningTag,
    lastSeenRelease: user.last_seen_release ?? "",
    dateJoined: user.date_joined,
    isAdmin,
  });
  const save = useSaveLastSeenReleaseMutation();
  // Remembered silently, for a new user or releases with nothing for them; if that fails, the next
  // visit tries again, so there is nothing to tell the user.
  const { mutate: markSeen } = useSaveLastSeenReleaseMutation({ reportsErrors: true });
  const silentTag = decision.kind === "markSeen" ? decision.tag : null;

  useEffect(() => {
    if (silentTag !== null) markSeen({ userId: user.id, release: silentTag });
  }, [markSeen, silentTag, user.id]);

  if (decision.kind !== "show") return null;
  const seen = () => save.mutate({ userId: user.id, release: decision.tag });
  const title = t("whatsnew.cardtitle", { version: runningTag });
  const newest = decision.releases[0];

  return (
    <Box
      component="section"
      aria-label={title}
      pos="fixed"
      left={{ base: 8, sm: LEFT_MENU_WIDTH + 16 }}
      right={{ base: 8, sm: "auto" }}
      bottom={{ base: FOOTER_HEIGHT + 8, sm: 16 }}
      w={{ base: "auto", sm: 360 }}
      className={classes.card}
      data-testid="whats-new-card"
    >
      <NoticeCard
        color="grape"
        icon={<Sparkles size={20} />}
        title={title}
        description={
          decision.releases.length > 1 ? t("whatsnew.releasecount", { count: decision.releases.length }) : undefined
        }
        actions={
          <Tooltip label={t("whatsnew.close")}>
            <CloseButton aria-label={t("whatsnew.close")} onClick={seen} />
          </Tooltip>
        }
      >
        <Highlights releases={decision.releases} />
        <UpgradeTasksLine isAdmin={isAdmin} />
        <Group gap="xs">
          <Button
            size="xs"
            color="grape"
            onClick={() => {
              onSeeWhatsNew(decision.releases.map(release => release.release));
              seen();
            }}
          >
            {t("whatsnew.seewhatsnew")}
          </Button>
          {newest ? (
            <Button
              size="xs"
              variant="default"
              component="a"
              href={newest.url}
              target="_blank"
              rel="noreferrer"
              leftSection={<ExternalLink size={14} />}
            >
              {t("whatsnew.releasenotes")}
            </Button>
          ) : null}
        </Group>
      </NoticeCard>
    </Box>
  );
}
