import pytz
from itertools import groupby

utc = pytz.UTC


class PhotosGroupedByDate:
    def __init__(self, location, date, photos):
        self.photos = photos
        self.date = date
        self.location = location


def filter_photos_by_media_type(photos, request):
    """Narrow *photos* per the request's media-type query.

    Mirrors the convention used by the search and album-date endpoints
    (``api/filters.py``): a truthy ``video`` param keeps only videos, a truthy
    ``photo`` param keeps only photos, and ``video`` wins if both are present.
    ``is_screenshot`` and ``is_document`` then keep only that category, ANDed
    like ``AlbumDateViewSet.MEDIA_FLAG_FILTERS``. Returns *photos* unchanged
    when none is set (or there is no request).

    Filtering is done in Python so it operates on the photos the caller already
    resolved - including prefetched relations - without issuing a fresh query
    that would drop the prefetch's constraints (e.g. hidden/visible) or defer
    the ``video`` field. Order is preserved.
    """
    if request is None:
        return photos
    params = request.query_params
    if params.get("video"):
        photos = [photo for photo in photos if photo.video]
    elif params.get("photo"):
        photos = [photo for photo in photos if not photo.video]
    if params.get("is_screenshot"):
        photos = [photo for photo in photos if photo.is_screenshot]
    if params.get("is_document"):
        photos = [photo for photo in photos if photo.is_document]
    return photos


def get_photos_ordered_by_date(photos, undated_date=None):
    """
    Efficiently group photos by date using itertools.groupby.
    Assumes photos are already ordered by exif_timestamp.

    Photos without a timestamp go last, in one group dated ``undated_date``.
    """
    # Convert to list once if it's a queryset
    if hasattr(photos, "_result_cache") and photos._result_cache is None:
        photos = list(photos)

    result = []
    no_timestamp_photos = []

    def date_key(photo):
        """Key function for grouping photos by date"""
        if photo.exif_timestamp:
            return photo.exif_timestamp.date().strftime("%Y-%m-%d")
        return None

    # Group consecutive photos by their date
    for date_str, group_photos in groupby(photos, key=date_key):
        group_list = list(group_photos)
        location = ""

        if date_str is not None:
            # Use the first photo's timestamp as the group date
            date = group_list[0].exif_timestamp
            result.append(PhotosGroupedByDate(location, date, group_list))
        else:
            # Collect photos without timestamps
            no_timestamp_photos.extend(group_list)

    # Add no timestamp photos as a single group at the end. Its date is null by
    # default, as in the public album serializer, so clients show their own
    # translated label rather than an English literal.
    if no_timestamp_photos:
        result.append(PhotosGroupedByDate("", undated_date, no_timestamp_photos))

    return result
