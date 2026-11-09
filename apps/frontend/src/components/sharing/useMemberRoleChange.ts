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
 *
 * The dialog follows its own request, not the mutation's isPending or a per-call onSuccess: those
 * track only the newest call, which may be another member's change saved meanwhile. A refused
 * change (toasted by the QueryClient) leaves the dialog open.
 */
export function useMemberRoleChange(albumID: string, album: UserAlbum | undefined) {
  const share = useShareUserAlbumMutation();
  const [opened, dialog] = useDisclosure(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [confirming, setConfirming] = useState(false);

  const params = (user: ListUser, role: MemberRole) => ({
    albumId: albumID,
    userId: String(user.id),
    share: role !== "none",
    role: role === "none" ? undefined : role,
  });

  const request = (user: ListUser, role: MemberRole) => {
    const count = contributedCount(album, user);
    if (count > 0 && role !== "contributor") {
      setPending({ user, role, count });
      dialog.open();
      return;
    }
    share.mutate(params(user, role));
  };

  const confirm = async () => {
    if (!pending || confirming) return;
    setConfirming(true);
    try {
      await share.mutateAsync(params(pending.user, pending.role));
      dialog.close();
    } catch {
      // Toasted by the QueryClient; the dialog stays to try again or cancel.
    } finally {
      setConfirming(false);
    }
  };

  return { request, pending, opened, close: dialog.close, confirm: () => void confirm(), loading: confirming };
}
