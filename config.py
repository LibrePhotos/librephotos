# add paths of the directories where your photos live.
# it will not look for photos recursively, so you might want to add subdirectories as well.
import os

image_dirs = [
    # '/home/hooram/with_exif/'
    '/home/hooram/Nextcloud/InstantUpload',
    '/home/hooram/Nextcloud/Camera Uploads',
    # '/home/hooram/Nextcloud/Photos/May 26th',
    # '/home/hooram/Nextcloud/kakaotalk',
    # '/mnt/ext/facebook_hooram/photos',
    # '/mnt/ext/pictures/DCIM',
    # '/mnt/ext/pictures/unorganized',
    # '/mnt/ext/pictures/Pictures',
    # '/mnt/ext/pictures/Android Photo Backup',
    # '/mnt/ext/pictures/Camera Uploads',
    # '/mnt/ext/pictures/hiking with anton and andrea',
    # '/mnt/ext/pictures/Aperture Library.aplibrary/Masters/',
    # '/mnt/ext/pictures/Aperture Library.aplibrary/Masters',
    # '/'

]

mapzen_api_key = 'take_care_of_me'
mapbox_api_key = os.environ['MAPBOX_API_KEY']
