import { Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { SizeSort } from "./photoSort";

type Props = Readonly<{
  sort: SizeSort;
  shown: number;
  total: number;
}>;

export function SizeSortNote({ sort, shown, total }: Props) {
  const { t } = useTranslation();
  const key = sort === "largest" ? "photosort.showinglargest" : "photosort.showingsmallest";
  return (
    <Text ta="left" size="sm" c="dimmed">
      {t(key, { shown, total })}
    </Text>
  );
}
