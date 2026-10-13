import React from "react";
import { useTranslation } from "react-i18next";
import { useMergePersonMutation, type Person } from "../../api_client/albums/hooks";
import { ConfirmModal } from "../modals/ConfirmModal";

/** A person a merge names: the one merged away or the one kept. */
export type MergePerson = Pick<Person, "id" | "name">;

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** Merged away: their faces move to `target` and they leave People. */
  source: MergePerson & Pick<Person, "face_count">;
  /** Kept, with their name and cover. */
  target: MergePerson;
  /** After the merge: the source's own page moves on to the target. */
  onMerged?: (targetId: string) => void;
}>;

/**
 * Asks before merging one person into another (#2206). A taken name means the same person,
 * so the rename dialog and the person page's "Merge into…" both end here.
 */
export function PersonMergeModal({ opened, onClose, source, target, onMerged }: Props) {
  const { t } = useTranslation();
  const mergePerson = useMergePersonMutation();
  const names = { source: source.name, target: target.name };

  return (
    <ConfirmModal
      opened={opened}
      onClose={onClose}
      onConfirm={() =>
        mergePerson.mutate(
          { targetId: target.id, targetName: target.name, sourceId: source.id, sourceName: source.name },
          { onSuccess: () => onMerged?.(target.id), onSettled: onClose }
        )
      }
      title={t("personalbum.mergepersontitle", { ...names })}
      message={
        <>
          {source.face_count > 0 && t("personalbum.mergepersonfaces", { count: source.face_count, ...names })}{" "}
          {t("personalbum.mergepersonremoved", { ...names })}
        </>
      }
      confirmLabel={t("personalbum.mergeperson")}
      irreversible
      // A large person takes a moment: the dialog stays until the people are merged
      loading={mergePerson.isPending}
    />
  );
}
