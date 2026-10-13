import { useDisclosure } from "@mantine/hooks";
import { useOptionalUpload } from "./UploadContext";
import type { UploadStatus } from "./useUploadQueue";

const UNFINISHED: ReadonlySet<UploadStatus> = new Set(["pending", "hashing", "uploading"]);

/**
 * Logging out mid-upload would silently drop the queue (the provider
 * unmounts), so `requestLogout` asks first while an upload runs. Spread
 * `modalProps` on a `LogoutWhileUploadingModal` rendered outside the menu.
 */
export function useLogoutGuard(logout: () => void) {
  const upload = useOptionalUpload();
  const [opened, { open, close }] = useDisclosure(false);

  const requestLogout = () => {
    if (upload?.isUploading) open();
    else logout();
  };

  const onConfirm = () => {
    close();
    upload?.cancel();
    logout();
  };

  const unfinished = upload?.items.filter(item => UNFINISHED.has(item.status)).length ?? 0;
  return { requestLogout, modalProps: { opened, onClose: close, onConfirm, unfinished } };
}
