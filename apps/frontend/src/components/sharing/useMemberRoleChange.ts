import type { ListUser, UserAlbum } from "@librephotos/api-client";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useShareUserAlbumMutation } from "../../api_client/albums/hooks";
import { contributedCount, type MemberRole } from "./memberRoles";

type PendingChange = { user: ListUser; role: MemberRole; count: number };

/**
 * Changing a user's role in the share dialog (#464). Taking a contributor's "Can add photos" away
 * (to "Can view" or "No access") takes the photos they added out of the album, so that asks first,
 * naming how many; every other change saves at once.
 */
export function useMemberRoleChange(albumID: string, album: UserAlbum | undefined) {
  const share = useShareUserAlbumMutation();
  const [opened, dialog] = useDisclosure(false);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const apply = (user: ListUser, role: MemberRole, onDone?: () => void) =>
    share.mutate(
      {
        albumId: albumID,
        userId: String(user.id),
        share: role !== "none",
        role: role === "none" ? undefined : role,
      },
      { onSuccess: onDone }
    );

  const request = (user: ListUser, role: MemberRole) => {
    const count = contributedCount(album, user);
    if (count > 0 && role !== "contributor") {
      setPending({ user, role, count });
      dialog.open();
      return;
    }
    apply(user, role);
  };

  const confirm = () => {
    if (pending) apply(pending.user, pending.role, dialog.close);
  };

  return { request, pending, opened, close: dialog.close, confirm, loading: share.isPending };
}
