import { Group, Kbd, Text, UnstyledButton } from "@mantine/core";
import { Spotlight as MantineSpotlight, spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpotlightActions } from "./useSpotlightActions";

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
        padding: "var(--mantine-spacing-xs) var(--mantine-spacing-md)",
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
      <Text size="sm" c="dimmed" style={{ flex: 1 }}>
        {t("spotlight.triggerPlaceholder")}
      </Text>
      <Group gap={4}>
        <Kbd size="xs">{isMac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd size="xs">K</Kbd>
      </Group>
    </UnstyledButton>
  );
}

export function SpotlightProvider() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { actions, filterOptions } = useSpotlightActions(query);

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
      filterOptions(newQuery);
    },
    [filterOptions]
  );

  return (
    <MantineSpotlight
      actions={actions}
      query={query}
      onQueryChange={handleQueryChange}
      nothingFound={t("spotlight.nothingFound")}
      highlightQuery
      limit={7}
      shortcut={["mod + k", "mod + p", "/"]}
      searchProps={{
        leftSection: <IconSearch size={20} stroke={1.5} />,
        placeholder: t("spotlight.placeholder"),
      }}
    />
  );
}

export { spotlight };
