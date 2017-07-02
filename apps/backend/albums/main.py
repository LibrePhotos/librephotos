from albums.models import Photo
from albums.models import Person
import os

image_dir = '/media/hooram/9832141a-0970-48e6-8af7-ea42fa520c17/pictures/Camera Uploads'

image_paths = os.listdir(image_dir)


for image_path in image_paths:
    if image_path.lower().endswith('.jpg'):
        try:
            img_abs_path = os.path.abspath(os.path.join(image_dir,image_path))
            photo = Photo(image_path=img_abs_path)
            photo._generate_md5()
            photo._generate_thumbnail()
            photo._extract_exif()
            photo.save()
            photo._extract_faces()
        except:
            print("could not load image %s"%image_path)

# photos = Photo.objects.all()
# for photo in photos:
#     print(photo.image_hash)
#     faces = photo.face_set.all()
#     print(photo.face_set.all())


