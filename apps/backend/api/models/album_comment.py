from django.db import models

from api.models.album_user import AlbumUser
from api.models.photo import Photo
from api.models.user import User


class AlbumComment(models.Model):
    """A comment on a photo in a shared album (#262).

    Comments belong to the album, not the photo: a photo in two shared albums
    has two threads, each seen only by that album's owner and members. The
    text is plain text, never markup (``api/albums/comments.py`` keeps it
    within ``MAX_COMMENT_LENGTH``).
    """

    album = models.ForeignKey(
        AlbumUser, on_delete=models.CASCADE, related_name="comments"
    )
    photo = models.ForeignKey(
        Photo, on_delete=models.CASCADE, related_name="album_comments"
    )
    author = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="album_comments"
    )
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["album", "photo", "created_at"])]

    def __str__(self) -> str:
        return f"Comment {self.pk} on {self.photo_id} in album {self.album_id}"


class AlbumLike(models.Model):
    """A member's heart on a photo in a shared album (#262); one per member."""

    album = models.ForeignKey(AlbumUser, on_delete=models.CASCADE, related_name="likes")
    photo = models.ForeignKey(
        Photo, on_delete=models.CASCADE, related_name="album_likes"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="album_likes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = (("album", "photo", "user"),)

    def __str__(self) -> str:
        return f"Like by {self.user_id} on {self.photo_id} in album {self.album_id}"
