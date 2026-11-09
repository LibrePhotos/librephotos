import { Button, CloseButton, Group, Kbd, Modal, Stack, Text, UnstyledButton } from "@mantine/core";
import { Spotlight as MantineSpotlight, spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { notification } from "../../service/notifications";
import { MissingPhotosConfirmText } from "../settings/MissingPhotosBadge";
import classes from "./Spotlight.module.css";
import { AVATAR_SIZE, useSpotlightActions } from "./useSpotlightActions";

type SpotlightTriggerProps = {
  className?: string;
};

// The words of the search page being shown (/search/<words>), so the header field keeps them.
function useShownSearchTerm(): string | null {
  const pathname = useRouterState({ select: state => state.location.pathname });
  const match = /^\/search\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function SpotlightTrigger({ className }: SpotlightTriggerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isMac, setIsMac] = useState(false);
  const term = useShownSearchTerm();

  useEffect(() => {
    setIsMac(/(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent));
  }, []);

  // On a search page the field shows the words searched for, with a button that clears them, as
  // Google Photos keeps the query in its search field.
  return (
    <div className={className ? `${classes.trigger} ${className}` : classes.trigger}>
      <UnstyledButton className={classes.open} onClick={() => spotlight.open()}>
        <IconSearch size={18} stroke={1.75} />
        {term !== null ? (
          <Text size="sm" className={classes.label} truncate>
            {term}
          </Text>
        ) : (
          <>
            {/* Phones have no keyboard shortcut to hint at, and need the header room */}
            <Text size="sm" c="dimmed" className={classes.label} truncate visibleFrom="sm">
              {t("spotlight.triggerPlaceholder")}
            </Text>
            <Text size="sm" c="dimmed" className={classes.label} truncate hiddenFrom="sm">
              {t("search.search")}
            </Text>
            <Group gap={4} wrap="nowrap" visibleFrom="sm">
              <Kbd size="xs">{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd size="xs">K</Kbd>
            </Group>
          </>
        )}
      </UnstyledButton>
      {term !== null && (
        <CloseButton size="sm" radius="xl" aria-label={t("clear")} onClick={() => void navigate({ to: "/" })} />
      )}
    </div>
  );
}

export function ConfirmDeleteMissingPhotosModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const deleteMissingPhotos = useDeleteMissingPhotosMutation();
  const { data: countStats } = useFetchCountStatsQuery();

  return (
    <Modal opened={opened} onClose={onClose} title={t("settings.missingphotosbutton")} centered>
      <Stack>
        <MissingPhotosConfirmText count={countStats?.num_missing_photos} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              deleteMissingPhotos.mutate(undefined, { onSuccess: () => notification.deleteMissingPhotos() });
              onClose();
            }}
          >
            {t("confirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function SpotlightProvider() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { actions, filterOptions, deleteMissingConfirm } = useSpotlightActions(query);

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
      filterOptions(newQuery);
    },
    [filterOptions]
  );

  return (
    <>
      <MantineSpotlight
        actions={actions}
        query={query}
        onQueryChange={handleQueryChange}
        nothingFound={t("spotlight.nothingFound")}
        highlightQuery
        // The limit counts across groups: on open, search suggestions alone would fill
        // it and hide every command, so the empty palette lists everything and scrolls.
        // Only then: a scrollable palette is always its full max height.
        limit={query.trim() ? 7 : Infinity}
        scrollable={!query.trim()}
        // Mantine 9 no longer puts the Spotlight root/content/body classes on the modal it
        // renders, so the rules that cap a scrollable palette at maxHeight never matched
        // and it grew to the full window height. Hand the classes back.
        classNames={{
          root: MantineSpotlight.classes.root,
          content: `${MantineSpotlight.classes.content} ${classes.palette}`,
          body: MantineSpotlight.classes.body,
          action: classes.action,
        }}
        // One width for icons and avatars, so every label starts at the same x
        styles={{
          actionSection: {
            width: AVATAR_SIZE,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          },
        }}
        shortcut={["mod + k", "mod + p", "/"]}
        searchProps={{
          leftSection: <IconSearch size={20} stroke={1.5} />,
          placeholder: t("spotlight.placeholder"),
        }}
      />
      <ConfirmDeleteMissingPhotosModal opened={deleteMissingConfirm.opened} onClose={deleteMissingConfirm.close} />
    </>
  );
}
