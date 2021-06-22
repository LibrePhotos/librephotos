class PhotosGroupedByDate():
    def __init__(self, location, date, photos):
        self.photos = photos
        self.date = date
        self.location = location

def get_photos_ordered_by_date(photos):
    from collections import defaultdict

    groups = defaultdict(list)

    for photo in photos:
        groups[photo.exif_timestamp].append(photo)

    groupedPhoto = list(groups.values())
    result = []
    for group in groupedPhoto:
        location = ""
        if(group[0].exif_timestamp):
            date = group[0].exif_timestamp.date().strftime("%Y-%m-%d")
        else:
            date = "No timestamp"
        result.append(PhotosGroupedByDate(location, date, group))
    return result