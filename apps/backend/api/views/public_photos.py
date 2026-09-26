import uuid

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Photo
from api.models.photo_share import PhotoShare
from api.serializers.photos import PublicPhotoDetailSerializer
from api.views.views import UnifiedMediaAccessView

SHARE_ACTIONS = ("enable", "rotate", "disable")

# What an anonymous holder of a photo link gets to see: the big thumbnail,
# plus the original file for videos because a <video> needs something it can
# play (album shares stream the same file). Never the original of a still,
# never face crops, never a URL derived from the content hash.
SHARED_MEDIA_KINDS = ("thumbnail", "video")

# Fields of PublicPhotoDetailSerializer a photo link must not hand out: the
# content hash and the hash-addressed /media/ URLs derived from it. The page
# gets slug-scoped media URLs instead, so revoking or replacing the link cuts
# the media off together with the metadata.
_HASH_DERIVED_FIELDS = (
    "image_hash",
    "square_thumbnail_url",
    "big_thumbnail_url",
    "small_square_thumbnail_url",
)


def shared_photo_media_url(slug, kind):
    return f"/api/public/photo/{slug}/media/{kind}/"


def active_photo_share(slug):
    """The live share for ``slug``, or None.

    A share stops resolving as soon as it is revoked or rotated (the slug is
    gone), and while its photo is hidden, in the trash or removed.
    """
    if not slug:
        return None
    return (
        PhotoShare.objects.filter(
            enabled=True,
            slug=slug,
            photo__hidden=False,
            photo__in_trashcan=False,
            photo__removed=False,
        )
        .select_related("photo", "photo__owner")
        .first()
    )


def _owned_photo(user, photo_id):
    """Resolve ``photo_id`` (a Photo UUID or an image_hash) among ``user``'s photos.

    An image_hash is an md5 plus the owner's id, so it is not a UUID and must
    not be fed to the primary-key lookup (that raises a ValidationError).
    """
    photos = Photo.objects.owned_by(user)
    try:
        pk = uuid.UUID(photo_id)
    except ValueError:
        pk = None
    if pk is not None:
        photo = photos.filter(pk=pk).first()
        if photo is not None:
            return photo
    return photos.filter(image_hash=photo_id).first()


def _share_payload(share):
    if share is None or not share.is_active():
        return {"enabled": False, "slug": None, "url": None}
    return {
        "enabled": True,
        "slug": share.slug,
        "url": f"/public/p/{share.slug}",
        "created_at": share.created_at,
    }


class SetPhotoShare(APIView):
    """Create, rotate or disable the public share for one photo.

    ``action``: ``enable`` (create one, or return the existing link),
    ``rotate`` (mint a new slug, killing the old link) or ``disable``
    (revoke; the slug is dropped so the next enable mints a fresh one).

    Sharing a photo this way does not touch ``Photo.public``.
    """

    def post(self, request, format=None):
        photo_id = request.data.get("photo_id")
        action = request.data.get("action") or "enable"

        if not isinstance(photo_id, str) or not photo_id:
            return Response(
                {"status": False, "message": "Missing parameters"}, status=400
            )
        if not isinstance(action, str) or action.lower() not in SHARE_ACTIONS:
            return Response({"status": False, "message": "Unknown action"}, status=400)
        action = action.lower()

        # Someone else's photo is reported exactly like a missing one, so the
        # endpoint cannot be used to probe which hashes exist.
        photo = _owned_photo(request.user, photo_id)
        if photo is None:
            return Response({"status": False, "message": "No such photo"}, status=404)

        if action == "disable":
            share = PhotoShare.objects.filter(photo=photo).first()
            if share is not None:
                # Revoking has to actually revoke: keeping the slug would hand
                # the next share out under the withdrawn URL, so everyone that
                # link ever reached would silently get access again (issue #76).
                share.enabled = False
                share.slug = None
                share.save()
            return Response({"status": True, "share": _share_payload(share)})

        share, _ = PhotoShare.objects.get_or_create(photo=photo)
        if action == "rotate":
            share.rotate()
        else:
            share.enabled = True
        share.save()

        return Response({"status": True, "share": _share_payload(share)})


class PhotoShareList(APIView):
    """List the caller's active photo shares, newest first."""

    def get(self, request, format=None):
        shares = (
            PhotoShare.objects.filter(
                photo__in=Photo.objects.owned_by(request.user),
                enabled=True,
                slug__isnull=False,
            )
            .select_related("photo")
            .order_by("-created_at")
        )
        results = []
        for share in shares:
            payload = _share_payload(share)
            payload["photo_id"] = str(share.photo_id)
            payload["image_hash"] = share.photo.image_hash
            results.append(payload)
        return Response({"results": results})


class PublicPhotoBySlug(APIView):
    """Serve a photo's metadata to anonymous visitors holding a share slug."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("slug", OpenApiTypes.STR)],
        description="Returns a publicly shared photo by share slug if active",
    )
    def get(self, request, slug):
        share = active_photo_share(slug)
        if share is None:
            return Response(status=404)

        photo = share.photo
        sharing_settings = share.get_effective_sharing_settings()
        data = dict(
            PublicPhotoDetailSerializer(
                photo,
                context={"request": request, "sharing_settings": sharing_settings},
            ).data
        )
        for field in _HASH_DERIVED_FIELDS:
            data.pop(field, None)
        # Names follow the owner's share_faces setting; face crops are not
        # part of a photo link.
        data["people"] = [{"name": person["name"]} for person in data["people"]]
        data["thumbnail_url"] = shared_photo_media_url(share.slug, "thumbnail")
        data["video_url"] = (
            shared_photo_media_url(share.slug, "video") if photo.video else None
        )
        return Response({"results": data, "sharing_settings": sharing_settings})


class PublicPhotoMediaBySlug(UnifiedMediaAccessView):
    """Media for a shared photo, addressed by the share's slug.

    The grant lives in the URL, not in the photo: replacing or revoking the
    link, or hiding/trashing the photo, stops these URLs at once, while the
    photo's hash-addressed /media/ URLs keep requiring a login.
    """

    def get(self, request, slug, kind, format=None):
        share = active_photo_share(slug)
        if share is None or kind not in SHARED_MEDIA_KINDS:
            return HttpResponse(status=404)

        photo = share.photo
        use_proxy = self._should_use_proxy()
        if kind == "thumbnail":
            response = self._generate_response(
                photo, "thumbnails_big", photo.image_hash, False, use_proxy
            )
        elif photo.video:
            response = self._generate_response_original(photo, use_proxy, False)
        else:
            return HttpResponse(status=404)

        # Browsers may keep a copy but must ask again before reusing it, so a
        # revoked link does not live on in their caches.
        response["Cache-Control"] = "private, no-cache"
        return response
