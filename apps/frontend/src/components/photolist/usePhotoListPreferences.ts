import { useDebouncedCallback } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useUpdateUserMutation } from "../../api_client/user/hooks";
import { userKeys } from "../../api_client/user/keys";
import type { User } from "../../api_client/user/types";

export type HeaderSize = "large" | "normal" | "small";

export const isHeaderSize = (value: string): value is HeaderSize =>
  value === "large" || value === "normal" || value === "small";

// The display preferences of a photo list (thumbnail size, text alignment, header
// size). The menu shows the local values at once; the profile is saved debounced.
export const usePhotoListPreferences = (userSelfDetails: User | undefined) => {
  // Silent: the debounced grid preference saves would otherwise pop an "Update user" toast.
  const updateUser = useUpdateUserMutation({ silent: true });
  const queryClient = useQueryClient();

  const imageScale = userSelfDetails?.image_scale ?? 1;
  const textAlignment = userSelfDetails?.text_alignment ?? "right";
  const headerSize = userSelfDetails?.header_size ?? "large";

  const [localImageScale, setLocalImageScale] = useState(imageScale);
  const [localTextAlignment, setLocalTextAlignment] = useState<"left" | "right">(textAlignment);
  const [localHeaderSize, setLocalHeaderSize] = useState<HeaderSize>(headerSize);

  useEffect(() => {
    setLocalImageScale(imageScale);
    setLocalTextAlignment(textAlignment);
    setLocalHeaderSize(headerSize);
  }, [imageScale, textAlignment, headerSize]);

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

  return {
    localImageScale,
    localTextAlignment,
    localHeaderSize,
    handleThumbnailSizeChange,
    handleTextAlignmentChange,
    handleHeaderSizeChange,
  };
};
