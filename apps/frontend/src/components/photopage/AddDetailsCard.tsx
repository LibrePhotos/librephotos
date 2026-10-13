import { Button, Group } from "@mantine/core";
import type { TablerIcon } from "@tabler/icons-react";
import { IconMapPinPlus, IconNotes, IconPlus, IconTagPlus, IconUserPlus } from "@tabler/icons-react";
import type { ParseKeys } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { PhotoCard } from "./PhotoCard";

/** A detail of the photo the owner can add from the page. */
export type AddableDetail = "caption" | "tags" | "place" | "face";

const OFFERS: Record<AddableDetail, { icon: TablerIcon; label: ParseKeys }> = {
  caption: { icon: IconNotes, label: "photopage.add.caption" },
  tags: { icon: IconTagPlus, label: "photopage.add.tags" },
  place: { icon: IconMapPinPlus, label: "photopage.add.place" },
  face: { icon: IconUserPlus, label: "photopage.add.face" },
};

type Props = Readonly<{
  /** What the photo lacks, in the order the cards above have it. */
  missing: readonly AddableDetail[];
  onAdd: (detail: AddableDetail) => void;
}>;

/** Everything the photo lacks, as one card of buttons rather than a "No ..." row each. */
export function AddDetailsCard({ missing, onAdd }: Props) {
  const { t } = useTranslation();
  return (
    <PhotoCard icon={IconPlus} color="gray" title={t("photopage.add.title")}>
      <Group gap="xs">
        {missing.map(detail => {
          const { icon: Icon, label } = OFFERS[detail];
          return (
            <Button
              key={detail}
              variant="default"
              size="xs"
              leftSection={<Icon size={16} />}
              onClick={() => onAdd(detail)}
            >
              {t(label)}
            </Button>
          );
        })}
      </Group>
    </PhotoCard>
  );
}
