import pytz

utc = pytz.UTC


class PhotosGroupedByDate:
    def __init__(self, location, date, photos):
        self.photos = photos
        self.date = date
        self.location = location


def get_photos_ordered_by_date(photos):
    from collections import defaultdict

    groups = defaultdict(list)

    for photo in photos:
        if photo.exif_timestamp:
            groups[photo.exif_timestamp.date().strftime("%Y-%m-%d")].append(photo)
        else:
            groups[photo.exif_timestamp].append(photo)

    grouped_photo = list(groups.values())
    result = []
    no_timestamp_photos = []
    for group in grouped_photo:
        location = ""
        for photo in group:
            if photo.exif_timestamp:
                date = photo.exif_timestamp
                result.append(PhotosGroupedByDate(location, date, group))
            else:
                date = "No timestamp"
                no_timestamp_photos = PhotosGroupedByDate(location, date, group)
    # add no timestamp last
    if no_timestamp_photos != []:
        result.append(no_timestamp_photos)
    return result
