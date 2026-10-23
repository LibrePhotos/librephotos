import type { AlbumLikes } from "@librephotos/api-client";
import { ActionIcon, Divider, Group, Stack, Text, Title } from "@mantine/core";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
import {
  useAlbumCommentMutations,
  useAlbumPhotoCommentsQuery,
  useAlbumPhotoLikesQuery,
  useFetchUserAlbumQuery,
  useSetAlbumPhotoLikedMutation,
} from "../../api_client/albums/hooks";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { sharerName } from "../sharing/sharerGroups";
import { AlbumThreadContext } from "./albumThread";
import { CommentForm } from "./CommentForm";
import { CommentItem } from "./CommentItem";

/** At most this many comments render; older ones stay on the server. */
const SHOWN_COMMENTS = 100;

/** The lightbox's key for the photo: its id, or its image hash on a page that only has that. */
type Props = Readonly<{ photoKey: string }>;

/** Who liked it, in words: "Liked by Anna, Clara and you". */
function likedByLine(t: TFunction, likes: AlbumLikes): string {
  const names = likes.users.map(user => sharerName(user, user.username));
  return t("collab.likedBy", { names: names.join(", ") });
}

type LikeProps = Readonly<{ albumId: string; photoId: string; enabled: boolean }>;

/** The heart and who gave one; with comments off only who gave one, as nobody can add a heart. */
function LikeButton({ albumId, photoId, enabled }: LikeProps) {
  const { t } = useTranslation();
  const { data: likes } = useAlbumPhotoLikesQuery(albumId, photoId);
  const setLiked = useSetAlbumPhotoLikedMutation({ albumId, photoId });
  const count = likes?.count ?? 0;
  const liked = likes?.liked_by_me ?? false;
  return (
    <Group gap={4} wrap="nowrap">
      {enabled && (
        <ActionIcon
          variant="subtle"
          color="red"
          aria-pressed={liked}
          aria-label={t(liked ? "collab.unlike" : "collab.like", { count })}
          loading={setLiked.isPending}
          onClick={() => setLiked.mutate(!liked)}
        >
          {liked ? <IconHeartFilled size={ICON_SIZE.menu} /> : <IconHeart size={ICON_SIZE.menu} />}
        </ActionIcon>
      )}
      {likes && count > 0 && (
        <Text size="xs" c="dimmed">
          {likedByLine(t, likes)}
        </Text>
      )}
    </Group>
  );
}

/**
 * The comments and likes of a photo in the shared album the lightbox was opened from (#262). They
 * belong to this album: the same photo in another album has another thread.
 */
export function AlbumThreadSection({ photoKey }: Props) {
  const albumId = useContext(AlbumThreadContext);
  if (albumId === undefined) return null;
  return <AlbumThreadOf albumId={albumId} photoKey={photoKey} />;
}

/** The thread is keyed by the photo's id; the details (cached for the panel) give it. */
function AlbumThreadOf({ albumId, photoKey }: Readonly<{ albumId: string; photoKey: string }>) {
  const { data: photo } = useFetchPhotoDetailsQuery(photoKey);
  if (!photo) return null;
  return <AlbumThread albumId={albumId} photoId={photo.id} />;
}

function AlbumThread({ albumId, photoId }: Readonly<{ albumId: string; photoId: string }>) {
  const { t } = useTranslation();
  const { data: comments = [], isError } = useAlbumPhotoCommentsQuery(albumId, photoId);
  const { data: album } = useFetchUserAlbumQuery(albumId);
  const { add } = useAlbumCommentMutations({ albumId, photoId });
  // A photo the album does not show (any more): no thread to show.
  if (isError) return null;
  const enabled = album?.comments_enabled ?? true;
  const shown = comments.slice(-SHOWN_COMMENTS);

  return (
    <Stack gap="xs">
      <Divider />
      <Group justify="space-between" wrap="nowrap">
        <Title order={5}>{t("collab.comments")}</Title>
        <LikeButton albumId={albumId} photoId={photoId} enabled={enabled} />
      </Group>
      {comments.length > SHOWN_COMMENTS && (
        <Text size="xs" c="dimmed">
          {t("collab.latestOnly", { count: SHOWN_COMMENTS })}
        </Text>
      )}
      {shown.length === 0 && (
        <Text size="sm" c="dimmed">
          {t("collab.noComments")}
        </Text>
      )}
      {shown.map(comment => (
        <CommentItem key={comment.id} comment={comment} albumId={albumId} photoId={photoId} />
      ))}
      {enabled ? (
        <CommentForm
          submitLabel={t("collab.send")}
          loading={add.isPending}
          onSubmit={(text, done) => add.mutate(text, { onSuccess: done })}
        />
      ) : (
        <Text size="sm" c="dimmed">
          {t("collab.commentsOff")}
        </Text>
      )}
    </Stack>
  );
}
