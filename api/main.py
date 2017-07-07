from api.models import Photo
from api.models import Person
import os
import datetime

image_dir = '/home/hooram/Nextcloud/Photos/tuebingen/'
image_dir = "/Users/hooram/ownCloud/Photos/tuebingen"
# image_dir = "/mnt/ext/code/ownphotos/data/samplephotos"
image_paths = os.listdir(image_dir)


for image_path in image_paths:
    if image_path.lower().endswith('.jpg'):
        try:
            img_abs_path = os.path.abspath(os.path.join(image_dir,image_path))
            qs = Photo.objects.filter(image_path=img_abs_path)
            if qs.count() < 1:
                photo = Photo(image_path=img_abs_path)
                photo._generate_md5()
                
                start = datetime.datetime.now()
                photo._generate_thumbnail()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                print('thumbnail get', elapsed)

                start = datetime.datetime.now()
                photo._generate_square_thumbnail()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                print('square thumbnail gen', elapsed)
                
                start = datetime.datetime.now()
                photo._save_image_to_db()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                print('image save', elapsed)

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


