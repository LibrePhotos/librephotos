from rest_framework import status
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.serving_permissions import diagnose_media_path
from api.models import Photo
from api.views.photos import _get_photo_filter_kwargs


class MediaPermissionDiagnosticsView(APIView):
    """Answer "why did serving this original just fail?" for an administrator.

    The frontend reaches here only after a media request has actually come back
    403, because a `<video>` element surfaces no HTTP status of its own and the
    generic "could not be loaded" it shows instead is what made issue #714 an
    unsolvable report for years.

    Administrators only, and not out of ceremony: the answer necessarily
    contains absolute filesystem paths, ownership and mode bits, which are of
    no use to someone who cannot change them and should not be handed to them
    either. Regular users get the plain "ask your administrator" message that
    the frontend renders without ever calling this.
    """

    permission_classes = (IsAdminUser,)

    def get(self, request, fname, format=None):
        photo = (
            Photo.objects.filter(**_get_photo_filter_kwargs(fname))
            .select_related("main_file")
            .first()
        )
        if photo is None:
            return Response(
                {"detail": "No photo matches that identifier."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if photo.main_file is None:
            # The scan has already detached this one; there is no path left to
            # inspect and permissions are not the story.
            return Response(
                {
                    "path": None,
                    "exists": False,
                    "readable_by_webserver": False,
                    "cause": "missing",
                    "blocking": None,
                    "remedies": [],
                }
            )
        return Response(diagnose_media_path(photo.main_file.path))
