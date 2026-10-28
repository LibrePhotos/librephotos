import { Anchor, Button, Group, Modal, Paper, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { IconExternalLink as ExternalLink } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchImageTagQuery } from "../../api_client/server";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { releasesForMenu, withHighlights } from "./selectUnseen";
import { WHATS_NEW_RELEASES, type WhatsNewHighlight, type WhatsNewRelease } from "./whatsNewReleases";

type WhatsNewModalProps = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The releases to show, by tag (the card's unseen ones); null for the running one and earlier. */
  releases: readonly string[] | null;
}>;

/** The releases the dialog shows, newest first, with only the highlights this user may see. */
function useShownReleases(tags: readonly string[] | null): WhatsNewRelease[] {
  const { data: user } = useCurrentUserSelfDetailsQuery();
  const { data: imageInfos } = useFetchImageTagQuery();
  const isAdmin = user?.is_superuser === true;
  if (tags === null) return releasesForMenu(WHATS_NEW_RELEASES, imageInfos?.image_tag ?? "", isAdmin);
  return withHighlights(
    WHATS_NEW_RELEASES.filter(release => tags.includes(release.release)),
    isAdmin
  );
}

/** The release's after-update steps, above its highlights. */
function AfterUpdateSection({ release, onOpen }: Readonly<{ release: WhatsNewRelease; onOpen: () => void }>) {
  const { t } = useTranslation();
  if (release.after_update.length === 0) return null;
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
        {t("whatsnew.afterupdate")}
      </Text>
      {release.after_update.map(step => (
        <HighlightItem key={step.id} highlight={step} onOpen={onOpen} />
      ))}
      {release.highlights.length > 0 ? (
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" mt="xs">
          {t("whatsnew.highlights")}
        </Text>
      ) : null}
    </Stack>
  );
}

function HighlightItem({ highlight, onOpen }: Readonly<{ highlight: WhatsNewHighlight; onOpen: () => void }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = highlight.open_in_app;
  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap={4}>
        <Title order={3} size="h5">
          {highlight.title}
        </Title>
        <Text size="sm">{highlight.body}</Text>
        <Group gap="md">
          {path ? (
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => {
                onOpen();
                void navigate({ href: path });
              }}
            >
              {t("whatsnew.openinapp")}
            </Anchor>
          ) : null}
          <Anchor href={highlight.learn_more} target="_blank" rel="noreferrer" size="sm">
            {t("whatsnew.learnmore")}
          </Anchor>
        </Group>
      </Stack>
    </Paper>
  );
}

/**
 * The What's new dialog (#2305): every highlight of a release with a link to its docs section and,
 * where there is one, to the place in the app. Several releases (unseen ones, or the history from
 * the account menu) get a switch at the top. Content stays English for now; the docs link has more.
 */
export function WhatsNewModal({ opened, onClose, releases: tags }: WhatsNewModalProps) {
  const { t } = useTranslation();
  const releases = useShownReleases(tags);
  const [selected, setSelected] = useState(releases[0]?.release ?? "");
  const release = releases.find(candidate => candidate.release === selected) ?? releases[0];

  return (
    <Modal opened={opened} onClose={onClose} title={t("whatsnew.dialogtitle")} size="lg">
      <Stack>
        {releases.length > 1 ? (
          <SegmentedControl
            aria-label={t("whatsnew.release")}
            value={release?.release ?? ""}
            onChange={setSelected}
            data={releases.map(candidate => candidate.release)}
          />
        ) : null}
        {release ? (
          <>
            <Text c="dimmed" size="sm">
              {release.summary}
            </Text>
            <AfterUpdateSection release={release} onOpen={onClose} />
            {release.highlights.map(highlight => (
              <HighlightItem key={highlight.id} highlight={highlight} onOpen={onClose} />
            ))}
          </>
        ) : (
          <Text c="dimmed">{t("whatsnew.nothing")}</Text>
        )}
        <Group justify="space-between">
          {release ? (
            <Button
              variant="default"
              component="a"
              href={release.url}
              target="_blank"
              rel="noreferrer"
              leftSection={<ExternalLink size={16} />}
            >
              {t("whatsnew.releasenotes")}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>{t("whatsnew.done")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
