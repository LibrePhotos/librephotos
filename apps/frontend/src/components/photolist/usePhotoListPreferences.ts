import type { PhotoOrder, User } from "@librephotos/api-client";
import { useDebouncedCallback } from "@mantine/hooks";
import { isEqual } from "lodash-es";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { useSetPhotoOrderMutation } from "../../api_client/user/hooks/usePhotoOrder";
import { useServerDraft } from "../../hooks/useServerDraft";
import { ScrubberStyle } from "../scrollscrubber/scrollScrubberTypes";

export type HeaderSize = "large" | "normal" | "small";

export const isHeaderSize = (value: string): value is HeaderSize =>
  value === "large" || value === "normal" || value === "small";

export const isScrubberStyle = (value: string): value is ScrubberStyle => ScrubberStyle.safeParse(value).success;

type DisplayPreferences = {
  image_scale: number;
  text_alignment: "left" | "right";
  header_size: HeaderSize;
  scrubber_style: ScrubberStyle;
};

type PreferenceFields = Pick<User, "id" | "image_scale" | "text_alignment" | "header_size" | "scrubber_style"> &
  Partial<Pick<User, "photo_order">>;

// The display preferences of a photo list (thumbnail size, text alignment, header size, scroll
// scrubber style). The menu shows a change at once, as a draft that a fetch of the profile leaves
// alone; the profile is saved after a pause, and a refused save shows the stored values again.
// The photo order (#2712) is saved at once instead: every list reads it from the cached user, which
// the save updates before it is sent, and each change reloads the list.
export const usePhotoListPreferences = (userSelfDetails: PreferenceFields | undefined) => {
  // Silent: the debounced grid preference saves would otherwise pop an "Update user" toast.
  const updateUser = useUpdateUserMutation({ silent: true });
  const setPhotoOrder = useSetPhotoOrderMutation();
  const userId = userSelfDetails?.id;

  const stored: DisplayPreferences = {
    image_scale: userSelfDetails?.image_scale ?? 1,
    text_alignment: userSelfDetails?.text_alignment ?? "left",
    header_size: userSelfDetails?.header_size ?? "normal",
    // An older server does not send it.
    scrubber_style: userSelfDetails?.scrubber_style ?? "thumb",
  };

  // Only the display preferences are sent: echoing the whole profile back sent the avatar URL,
  // which the backend rejects as "not a file" (#2153).
  const draft = useServerDraft(stored, {
    save: async preferences => {
      if (!userId) return false;
      try {
        await updateUser.mutateAsync({ id: userId, ...preferences });
        return true;
      } catch {
        return false;
      }
    },
    isEqual,
  });
  // Changes made within one pause are saved together.
  const flush = useDebouncedCallback(() => void draft.commit(), 500);
  const change = (patch: Partial<DisplayPreferences>) => {
    draft.update(current => ({ ...current, ...patch }));
    flush();
  };

  const handlePhotoOrderChange = (order: PhotoOrder) => {
    if (userId) setPhotoOrder.mutate({ userId, order });
  };

  return {
    localImageScale: draft.value.image_scale,
    localTextAlignment: draft.value.text_alignment,
    localHeaderSize: draft.value.header_size,
    localScrubberStyle: draft.value.scrubber_style,
    // An older server does not send it, and its lists are newest first.
    photoOrder: userSelfDetails?.photo_order ?? "newest",
    handlePhotoOrderChange,
    handleThumbnailSizeChange: (value: number) => change({ image_scale: value }),
    handleTextAlignmentChange: (alignment: "left" | "right") => change({ text_alignment: alignment }),
    handleHeaderSizeChange: (size: HeaderSize) => change({ header_size: size }),
    handleScrubberStyleChange: (style: ScrubberStyle) => change({ scrubber_style: style }),
  };
};
