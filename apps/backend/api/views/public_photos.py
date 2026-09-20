from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Photo
from api.models.photo_share import PhotoShare
from api.serializers.photos import PublicPhotoDetailSerializer


def _share_payload(share, request=None):
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
    """

    def post(self, request, format=None):
        data = dict(request.data)
        photo_id = data.get("photo_id")
        action = (data.get("action") or "enable").lower()

        if photo_id is None:
            return Response(
                {"status": False, "message": "Missing parameters"}, status=400
            )
        if action not in ("enable", "rotate", "disable"):
            return Response({"status": False, "message": "Unknown action"}, status=400)

        photo = Photo.objects.filter(pk=photo_id).first()
        if photo is None:
            photo = Photo.objects.filter(image_hash=photo_id).first()
        if photo is None:
            return Response({"status": False, "message": "No such photo"}, status=404)

        if photo.owner_id != request.user.id:
            return Response(
                {"status": False, "message": "You are not the owner of this photo"},
                status=403,
            )

        share, _ = PhotoShare.objects.get_or_create(photo=photo)
        if action == "disable":
            # Revoking has to actually revoke: keeping the slug would hand the
            # next share out under the withdrawn URL, so everyone that link
            # ever reached would silently get access again (issue #76).
            share.enabled = False
            share.slug = None
        elif action == "rotate":
            share.rotate()
        else:
            share.enabled = True
        share.save()

        return Response({"status": True, "share": _share_payload(share, request)})


class PhotoShareList(APIView):
    """List the caller's active photo shares, newest first."""

    def get(self, request, format=None):
        shares = (
            PhotoShare.objects.filter(
                photo__owner=request.user, enabled=True, slug__isnull=False
            )
            .select_related("photo")
            .order_by("-created_at")
        )
        results = []
        for share in shares:
            payload = _share_payload(share, request)
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
        share = (
            PhotoShare.objects.filter(enabled=True, slug=slug)
            .select_related("photo", "photo__owner")
            .first()
        )
        if share is None or share.photo.hidden or share.photo.in_trashcan:
            return Response(status=404)

        sharing_settings = share.get_effective_sharing_settings()
        serializer = PublicPhotoDetailSerializer(
            share.photo,
            context={"request": request, "sharing_settings": sharing_settings},
        )
        return Response(
            {"results": serializer.data, "sharing_settings": sharing_settings}
        )
