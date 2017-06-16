from albums.models import Photo
import os

image_dir = '/home/hooram/Nextcloud/Photos/korea/'

image_paths = os.listdir(image_dir)

for image_path in image_paths:
    img_abs_path = os.path.abspath(os.path.join(image_dir,image_path))
    photo = Photo(image_path=img_abs_path)
    photo._generate_md5()
    photo._generate_thumbnail()
    photo._extract_exif()
    photo.save()
