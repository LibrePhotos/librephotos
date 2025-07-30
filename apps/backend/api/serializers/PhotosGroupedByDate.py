import pytz
from itertools import groupby

utc = pytz.UTC


class PhotosGroupedByDate:
    def __init__(self, location, date, photos):
        self.photos = photos
        self.date = date
        self.location = location


def get_photos_ordered_by_date(photos):
    """
    Efficiently group photos by date using itertools.groupby.
    Assumes photos are already ordered by exif_timestamp.
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

    # Add no timestamp photos as a single group at the end
    if no_timestamp_photos:
        result.append(PhotosGroupedByDate("", "No timestamp", no_timestamp_photos))

    return result
