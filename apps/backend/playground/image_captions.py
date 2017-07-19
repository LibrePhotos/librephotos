import requests
import base64

from django.core.files import File

from api.models import Photo

import ipdb

photos = Photo.objects.all()

for idx,photo in enumerate(photos):
	if idx > 2: break
	try:
		b64img = str(base64.b64encode(photo.thumbnail.read()))
		photo.thumbnail.close()
		resp_captions = requests.post('http://localhost:5000/',data=b64img)

		ipdb.set_trace()
	except:
		print('error on image', photo.image_path)


