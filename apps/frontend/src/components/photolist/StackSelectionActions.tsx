import type { PigPhoto } from "@librephotos/api-client";
import { Menu } from "@mantine/core";
import { IconLayersLinked, IconLayersSubtract, IconStack2 } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateManualStackMutation,
  useMergeStacksMutation,
  useRemoveFromStackMutation,
} from "../../api_client/stacks";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";

type Props = Readonly<{
  selectedItems: PigPhoto[];
  selectAllMode: boolean;
  /** The hashes of the selected photos that have loaded. */
  imageHashes: string[];
  /** Clears the selection once an action is done. */
  onDone: () => void;
}>;

/** The manual stacks the selected photos are in, one entry per photo and stack. */
function manualStackPhotos(selectedItems: PigPhoto[]) {
  return selectedItems.flatMap(item =>
    (item.stacks ?? [])
      .filter(stack => stack.type === "manual")
      // Use image_hash if available, otherwise fall back to id
      .map(stack => ({ stackId: stack.id, photoHash: item.image_hash || item.id }))
  );
}

/**
 * The "Stack Actions" section of the selection menu: create a manual stack, merge the stacks of the
 * selection, or take the selection out of its manual stacks. They take a list of photos, so "Select
 * all" (a server-side query) is not supported; each item says why when it is off (#2608).
 */
export function StackSelectionActions({ selectedItems, selectAllMode, imageHashes, onDone }: Props) {
  const { t } = useTranslation();
  const createManualStack = useCreateManualStackMutation();
  const mergeStacks = useMergeStacksMutation();
  const removeFromStack = useRemoveFromStackMutation();
  const stackPhotos = manualStackPhotos(selectedItems);

  let selectionReason: string | undefined;
  if (selectAllMode) selectionReason = t("selectionactions.stacksselectall");
  else if (selectedItems.length === 0) selectionReason = t("selectionactions.selectphotosfirst");
  const createReason =
    selectionReason ?? (selectedItems.length < 2 ? t("selectionactions.createstacktwophotos") : undefined);
  const stacksReason = selectionReason ?? (stackPhotos.length === 0 ? t("selectionactions.nomanualstack") : undefined);

  const breakApart = () => {
    // Group by stack ID to remove photos from each stack
    const stacksByStackId = new Map<string, string[]>();
    stackPhotos.forEach(({ stackId, photoHash }) => {
      const photoHashes = stacksByStackId.get(stackId) ?? [];
      photoHashes.push(photoHash);
      stacksByStackId.set(stackId, photoHashes);
    });
    const requests = Array.from(stacksByStackId.entries()).map(([stackId, photoHashes]) =>
      removeFromStack.mutateAsync({ stackId, data: { photo_hashes: photoHashes } })
    );
    // A failed request is reported by the mutation error toast; the selection stays for a retry.
    Promise.all(requests).then(onDone, () => undefined);
  };

  return (
    <>
      <Menu.Divider />

      <Menu.Label>{t("selectionactions.stackactions")}</Menu.Label>

      <DisabledReason reason={createReason} position="left">
        <Menu.Item
          leftSection={<IconStack2 size={ICON_SIZE.menu} />}
          onClick={() => createManualStack.mutate({ photo_hashes: imageHashes }, { onSuccess: onDone })}
        >
          {t("selectionactions.createstack")}
        </Menu.Item>
      </DisabledReason>

      <DisabledReason reason={stacksReason} position="left">
        <Menu.Item
          leftSection={<IconLayersLinked size={ICON_SIZE.menu} />}
          onClick={() => mergeStacks.mutate({ photo_hashes: imageHashes }, { onSuccess: onDone })}
        >
          {t("selectionactions.mergestacks")}
        </Menu.Item>
      </DisabledReason>

      <DisabledReason reason={stacksReason} position="left">
        <Menu.Item leftSection={<IconLayersSubtract size={ICON_SIZE.menu} />} onClick={breakApart}>
          {t("selectionactions.breakapartstacks")}
        </Menu.Item>
      </DisabledReason>
    </>
  );
}
