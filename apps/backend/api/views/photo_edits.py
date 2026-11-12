"""A photo's non-destructive edit: ``/api/photos/<photo_id>/edit/``.

Owner only: anyone else gets the 404 of an unknown photo. The rendering and
the files are ``api.editing.renditions``' business.
"""

from __future__ import annotations

import uuid

from django.http import HttpResponse
from django.http.response import HttpResponseBase
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.editing import renditions
from api.editing.source import FILE_VERSION
from api.models import Photo, PhotoEdit
from api.serializers.photo_edits import PhotoEditStateSerializer, PhotoEditUpdateRequest
from api.serving.caching import not_modified

NOT_EDITABLE = "Videos cannot be edited."
FILE_MISSING = "The photo's file is not on disk. Rescan its folder or restore the file."
NOT_DECODABLE = "The photo's file cannot be read as a picture."
# The source changes with the file and its rotation, which the ETag carries:
# the browser keeps it, and asks whether it is still current every time.
SOURCE_CACHE_CONTROL = "private, no-cache"


def _owned_photo(request: Request, photo_id: uuid.UUID) -> Photo:
    photos = Photo.objects.owned_by(request_user(request)).select_related(
        "main_file", "thumbnail"
    )
    return get_object_or_404(photos, pk=photo_id)


def _state(photo: Photo) -> Response:
    edit = PhotoEdit.objects.filter(pk=photo.pk).first()
    if edit is None:
        # Never edited: the default recipe at version 0. No row is made.
        edit = PhotoEdit(photo=photo)
    return Response(PhotoEditStateSerializer(edit).data)


class PhotoEditView(APIView):
    """Read, save or revert a photo's edit."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="photo_edit_retrieve",
        description=(
            "The photo's edit: recipe, history and rendition. A photo never edited "
            "answers the default recipe with version 0; a reverted one the default "
            "recipe at its last version, which never goes back. Owner only (404 "
            "otherwise)."
        ),
        responses={200: PhotoEditStateSerializer},
    )
    def get(self, request: Request, photo_id: uuid.UUID) -> Response:
        return _state(_owned_photo(request, photo_id))

    @extend_schema(
        operation_id="photo_edit_update",
        description=(
            "Save the photo's recipe and history. The thumbnails show the edit when "
            "this answers; the full-size rendition is rendered afterwards (rendition "
            "pending). 400 not_editable for a video, not_decodable for a file that "
            "is not a picture; 404 file_missing when the file is not on disk."
        ),
        request=PhotoEditUpdateRequest,
        responses={200: PhotoEditStateSerializer},
    )
    def put(self, request: Request, photo_id: uuid.UUID) -> Response:
        photo = _owned_photo(request, photo_id)
        data = parse_body(request, PhotoEditUpdateRequest)
        try:
            renditions.save_edit(
                photo, data["settings"], data["history"], data["history_cursor"]
            )
        except renditions.NotEditableError as error:
            raise ValidationError(NOT_EDITABLE, code="not_editable") from error
        except renditions.FileMissingError as error:
            raise NotFound(FILE_MISSING, code="file_missing") from error
        except renditions.RenderError as error:
            raise ValidationError(NOT_DECODABLE, code="not_decodable") from error
        return _state(photo)

    @extend_schema(
        operation_id="photo_edit_destroy",
        description=(
            "Revert the photo to its original: the default recipe, no history, no "
            "rendition, and a new version (it never goes back, so a cached picture "
            "of an earlier version is never shown). The thumbnails and the face "
            "boxes are those of the original again."
        ),
        responses={204: None},
    )
    def delete(self, request: Request, photo_id: uuid.UUID) -> Response:
        renditions.reset_edit(_owned_photo(request, photo_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class PhotoEditSourceView(APIView):
    """The reduced source the web editor's preview works on."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="photo_edit_source_retrieve",
        description=(
            "The photo's edit source file (LPES, see the photo editing docs): the "
            "upright picture reduced for the editor's preview. Revalidated by ETag. "
            "400 not_editable for a video, not_decodable for a file that is not a "
            "picture; 404 file_missing when the file is not on disk."
        ),
        responses={
            (200, "application/octet-stream"): OpenApiResponse(
                response=OpenApiTypes.BINARY, description="An edit source file"
            ),
            304: OpenApiResponse(description="Unchanged since the ETag sent"),
        },
    )
    def get(self, request: Request, photo_id: uuid.UUID) -> HttpResponseBase:
        photo = _owned_photo(request, photo_id)
        main_file = photo.main_file
        etag = (
            f'"{main_file.hash if main_file else ""}-{photo.local_orientation}'
            f'-{FILE_VERSION}"'
        )
        unchanged = not_modified(request, etag)
        if unchanged is not None:
            return unchanged
        try:
            data = renditions.edit_source_file(photo)
        except renditions.NotEditableError as error:
            raise ValidationError(NOT_EDITABLE, code="not_editable") from error
        except renditions.FileMissingError as error:
            raise NotFound(FILE_MISSING, code="file_missing") from error
        except renditions.RenderError as error:
            raise ValidationError(NOT_DECODABLE, code="not_decodable") from error
        response = HttpResponse(data, content_type="application/octet-stream")
        response["ETag"] = etag
        response["Cache-Control"] = SOURCE_CACHE_CONTROL
        return response
