import { IconCopy, IconPhoto } from "@tabler/icons-react";
import type { DuplicateType } from "../../api_client/duplicates/types";

export function getDuplicateTypeIcon(type: DuplicateType, size = 14) {
  switch (type) {
    case "exact_copy":
      return <IconCopy size={size} />;
    case "visual_duplicate":
      return <IconPhoto size={size} />;
    default:
      return <IconCopy size={size} />;
  }
}

export function getDuplicateTypeColor(type: DuplicateType): string {
  switch (type) {
    case "exact_copy":
      return "red";
    case "visual_duplicate":
      return "orange";
    default:
      return "gray";
  }
}
