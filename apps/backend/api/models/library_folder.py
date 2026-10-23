from django.db import models

from api.models.scopes import OwnedQuerySet
from api.models.user import User


class LibraryFolderQuerySet(OwnedQuerySet["LibraryFolder"]):
    """Scoped to its owner through ``owner``."""


class LibraryFolder(models.Model):
    """A further folder of a user's library, beside the scan directory (#123).

    The scan directory (``User.scan_directory``) stays the main folder: uploads
    go below it by default and clients read it. These rows are the other
    folders the library scan walks and every "is this path in the library"
    check accepts (``api.photos.paths.library_roots``). An admin adds and
    removes them, as an admin sets the scan directory; no two users' folders
    overlap (``api.accounts.directories``). Removing one keeps its photos:
    they are then outside the library, like the photos of an old scan
    directory (#2036).
    """

    # A user's folders go with the account.
    owner = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="library_folders"
    )
    # Absolute and normalised, as ``os.path.abspath`` spells it.
    path = models.CharField(max_length=512)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = LibraryFolderQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                "owner", "path", name="unique_library_folder_per_owner"
            )
        ]

    def __str__(self) -> str:
        return f"{self.id or 0}: {self.path}"
