"""Comments and likes on the photos of a shared album (#262)."""

from rest_framework import serializers

from api.albums.comments import MAX_COMMENT_LENGTH, can_delete
from api.models import AlbumComment, AlbumUser, User
from api.serializers.photo_groups import PhotoGroupPageSerializer
from api.serializers.simple import SimpleUserSerializer


class AlbumCommentSerializer(serializers.ModelSerializer):
    """One comment: plain text, which clients show as text, never as markup."""

    author = SimpleUserSerializer(read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = AlbumComment
        fields = (
            "id",
            "author",
            "text",
            "created_at",
            "edited_at",
            "can_edit",
            "can_delete",
        )

    def _viewer(self) -> User | None:
        viewer = getattr(self.context.get("request"), "user", None)
        return viewer if isinstance(viewer, User) else None

    def get_can_edit(self, obj: AlbumComment) -> bool:
        """Only its author edits a comment."""
        viewer = self._viewer()
        return viewer is not None and obj.author_id == viewer.pk

    def get_can_delete(self, obj: AlbumComment) -> bool:
        """Its author, or the album's owner."""
        viewer = self._viewer()
        album = self.context.get("album")
        if viewer is None or not isinstance(album, AlbumUser):
            return False
        return can_delete(obj, album, viewer)


class AlbumCommentPageSerializer(PhotoGroupPageSerializer):
    """A page of a photo's thread in one album, oldest first."""

    results = AlbumCommentSerializer(many=True)


class AlbumCommentRequest(serializers.Serializer[None]):
    """The text of a comment: plain text, trimmed, not empty."""

    text = serializers.CharField(
        # Twice the limit before cleaning; api.albums.comments.clean_text
        # holds the stored text to MAX_COMMENT_LENGTH.
        max_length=2 * MAX_COMMENT_LENGTH,
        trim_whitespace=False,
        help_text=f"Plain text, at most {MAX_COMMENT_LENGTH} characters",
    )


class AlbumLikesSerializer(serializers.Serializer[None]):
    """The hearts on a photo in one album."""

    count = serializers.IntegerField()
    liked_by_me = serializers.BooleanField()
    users = SimpleUserSerializer(many=True)
