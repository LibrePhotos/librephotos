from api.models import Photo
from api.models import Person
import os

image_dir = '/home/hooram/Nextcloud/Photos/tuebingen/'
image_dir = "/Users/hooram/ownCloud/Camera Uploads"
image_paths = os.listdir(image_dir)


for image_path in image_paths:
    if image_path.lower().endswith('.jpg'):
        try:
            img_abs_path = os.path.abspath(os.path.join(image_dir,image_path))
            qs = Photo.objects.filter(image_path=img_abs_path)
            if qs.count() < 1:
                photo = Photo(image_path=img_abs_path)
                photo._generate_md5()
                photo._generate_thumbnail()
                photo._extract_exif()
                photo.save()
                photo._extract_faces()
            else:
                print("photo already exists in db")
        except Exception as e:
            print("could not load image %s"%image_path)
            print("ERROR: %s"%e.message)

# photos = Photo.objects.all()
# for photo in photos:
#     print(photo.image_hash)
#     faces = photo.face_set.all()
#     print(photo.face_set.all())


