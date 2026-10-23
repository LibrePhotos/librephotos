import { userKeys } from "@librephotos/api-client";
import type { PhotoOrder, User } from "@librephotos/api-client";
import { useDebouncedCallback } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { useSetPhotoOrderMutation } from "../../api_client/user/hooks/usePhotoOrder";
import { ScrubberStyle } from "../scrollscrubber/scrollScrubberTypes";

export type HeaderSize = "large" | "normal" | "small";

export const isHeaderSize = (value: string): value is HeaderSize =>
  value === "large" || value === "normal" || value === "small";

export const isScrubberStyle = (value: string): value is ScrubberStyle => ScrubberStyle.safeParse(value).success;

// The display preferences of a photo list (thumbnail size, text alignment, header
// size, scroll scrubber style). The menu shows the local values at once; the profile is saved debounced.
// The photo order (#2712) is saved at once instead: every list reads it from the cached user, which
// the save updates before it is sent, and each change reloads the list.
export const usePhotoListPreferences = (userSelfDetails: User | undefined) => {
  // Silent: the debounced grid preference saves would otherwise pop an "Update user" toast.
  const updateUser = useUpdateUserMutation({ silent: true });
  const setPhotoOrder = useSetPhotoOrderMutation();
  const queryClient = useQueryClient();

  const imageScale = userSelfDetails?.image_scale ?? 1;
  const textAlignment = userSelfDetails?.text_alignment ?? "right";
  const headerSize = userSelfDetails?.header_size ?? "large";
  // An older server does not send it.
  const scrubberStyle = userSelfDetails?.scrubber_style ?? "thumb";

  const [localImageScale, setLocalImageScale] = useState(imageScale);
  const [localTextAlignment, setLocalTextAlignment] = useState<"left" | "right">(textAlignment);
  const [localHeaderSize, setLocalHeaderSize] = useState<HeaderSize>(headerSize);
  const [localScrubberStyle, setLocalScrubberStyle] = useState<ScrubberStyle>(scrubberStyle);

  useEffect(() => {
    setLocalImageScale(imageScale);
    setLocalTextAlignment(textAlignment);
    setLocalHeaderSize(headerSize);
    setLocalScrubberStyle(scrubberStyle);
  }, [imageScale, textAlignment, headerSize, scrubberStyle]);

  // Only the changed preferences are sent: echoing the whole profile back sent
  // the avatar URL, which the backend rejects as "not a file" (#2153). Changes
  // made within one debounce window are merged so none of them is dropped.
  const pendingPreferences = useRef<Partial<User>>({});
  const flushPreferences = useDebouncedCallback(() => {
    const changes = pendingPreferences.current;
    pendingPreferences.current = {};
    const userId = userSelfDetails?.id;
    if (userId) {
      updateUser.mutate(
        { id: userId, ...changes },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: userKeys.selfDetails() });
          },
        }
      );
    }
  }, 500);
  const debouncedSavePreferences = (partial: Partial<User>) => {
    pendingPreferences.current = { ...pendingPreferences.current, ...partial };
    flushPreferences();
  };

  const handleThumbnailSizeChange = (value: number) => {
    setLocalImageScale(value);
    debouncedSavePreferences({ image_scale: value });
  };

  const handleTextAlignmentChange = (alignment: "left" | "right") => {
    setLocalTextAlignment(alignment);
    debouncedSavePreferences({ text_alignment: alignment });
  };

  const handleHeaderSizeChange = (size: HeaderSize) => {
    setLocalHeaderSize(size);
    debouncedSavePreferences({ header_size: size });
  };

  const handleScrubberStyleChange = (style: ScrubberStyle) => {
    setLocalScrubberStyle(style);
    debouncedSavePreferences({ scrubber_style: style });
  };

  const handlePhotoOrderChange = (order: PhotoOrder) => {
    if (userSelfDetails) setPhotoOrder.mutate({ userId: userSelfDetails.id, order });
  };

  return {
    localImageScale,
    localTextAlignment,
    localHeaderSize,
    localScrubberStyle,
    // An older server does not send it, and its lists are newest first.
    photoOrder: userSelfDetails?.photo_order ?? "newest",
    handlePhotoOrderChange,
    handleThumbnailSizeChange,
    handleTextAlignmentChange,
    handleHeaderSizeChange,
    handleScrubberStyleChange,
  };
};
