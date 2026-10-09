import { Button, Group, Kbd, Modal, Stack, Text, UnstyledButton } from "@mantine/core";
import { Spotlight as MantineSpotlight, spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteMissingPhotosMutation } from "../../api_client/photos/hooks";
import { notification } from "../../service/notifications";
import { AVATAR_SIZE, useSpotlightActions } from "./useSpotlightActions";

type SpotlightTriggerProps = {
  className?: string;
};

export function SpotlightTrigger({ className }: SpotlightTriggerProps) {
  const { t } = useTranslation();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent));
  }, []);

  return (
    <UnstyledButton
      className={className}
      onClick={() => spotlight.open()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--mantine-spacing-sm)",
        // As tall as the header's inputs, not the 44px that vertical padding gave
        padding: "0 var(--mantine-spacing-md)",
        minHeight: 36,
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        color: "var(--mantine-color-placeholder)",
        cursor: "pointer",
        minWidth: 0,
        flex: 1,
        maxWidth: 400,
      }}
    >
      <IconSearch size={16} stroke={1.5} />
      {/* Phones have no keyboard shortcut to hint at, and need the header room */}
      <Text size="sm" c="dimmed" style={{ flex: 1 }} truncate visibleFrom="sm">
        {t("spotlight.triggerPlaceholder")}
      </Text>
      <Text size="sm" c="dimmed" style={{ flex: 1 }} truncate hiddenFrom="sm">
        {t("search.search")}
      </Text>
      <Group gap={4} wrap="nowrap" visibleFrom="sm">
        <Kbd size="xs">{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd size="xs">K</Kbd>
      </Group>
    </UnstyledButton>
  );
}

export function ConfirmDeleteMissingPhotosModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const deleteMissingPhotos = useDeleteMissingPhotosMutation();

  return (
    <Modal opened={opened} onClose={onClose} title={t("settings.missingphotosbutton")} centered>
      <Stack>
        <Text size="sm">{t("settings.missingphotosconfirm")}</Text>
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

export { spotlight };
