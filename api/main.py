from api.models import Photo
from api.models import Person
import os
import datetime
from tqdm import tqdm

from config import image_dirs

image_paths = []
for image_dir in image_dirs:
    image_paths.extend([os.path.join(dp, f) for dp, dn, fn in os.walk(image_dir) for f in fn]
)

for image_path in tqdm(image_paths):
    if image_path.lower().endswith('.jpg'):
        try:
            img_abs_path = os.path.abspath(os.path.join(image_dir,image_path))
            qs = Photo.objects.filter(image_path=img_abs_path)
            if qs.count() < 1:
                photo = Photo(image_path=img_abs_path)
                photo.added_on = datetime.datetime.now()
                photo.save()
                photo._generate_md5()
                
                start = datetime.datetime.now()
                photo._generate_thumbnail()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                # print('thumbnail get', elapsed)

                start = datetime.datetime.now()
                photo._save_image_to_db()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                # print('image save', elapsed)

                start = datetime.datetime.now()
                photo._extract_exif()
                photo.save()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                # print('exif extraction', elapsed)

                # start = datetime.datetime.now()
                # photo._geolocate()
                # photo.save()
                # elapsed = (datetime.datetime.now() - start).total_seconds()
                # print('geolocation', elapsed)

                start = datetime.datetime.now()
                photo._extract_faces()
                elapsed = (datetime.datetime.now() - start).total_seconds()
                # print('face extraction', elapsed)

                start = datetime.datetime.now()
                photo._add_to_album_date()
                elapsed = (datetime.datetime.now() - start).total_seconds()

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


