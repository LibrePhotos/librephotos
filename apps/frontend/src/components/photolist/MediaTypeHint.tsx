import { Anchor, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_MEDIA_TYPE } from "./mediaTypeFilter";
import { MEDIA_TYPE_OPTIONS } from "./mediaTypeOptions";
import { useMediaTypeFilter, useSetMediaTypeFilter } from "./useMediaTypeFilter";

// The header's "Videos only · Show all" line while the media filter narrows the
// page, so a filtered (or filtered-empty) page never reads as the whole set.
export function MediaTypeHint() {
  const { t } = useTranslation();
  const current = useMediaTypeFilter();
  const select = useSetMediaTypeFilter();
  if (current === DEFAULT_MEDIA_TYPE) return null;

  return (
    <Text ta="left" size="sm" c="blue">
      {t(MEDIA_TYPE_OPTIONS[current].labelKey)}
      {" · "}
      <Anchor component="button" type="button" size="sm" onClick={() => select(DEFAULT_MEDIA_TYPE)}>
        {t("mediafilter.showall")}
      </Anchor>
    </Text>
  );
}
