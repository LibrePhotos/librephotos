from api.models import Photo, Face
import base64
import requests
import numpy as np
from sklearn.manifold import TSNE
import matplotlib.pyplot as plt
from seaborn import color_palette

# p = Photo.objects.first()
# image_path = p.image_path
# captions = {}
# with open(image_path, "rb") as image_file:
#     encoded_string = base64.b64encode(image_file.read())
# encoded_string = str(encoded_string)[2:-1]
# resp_captions = requests.post('http://localhost:5001/longcaptions/',data=encoded_string)




faces = Face.objects.all()
face_encodings = [np.frombuffer(bytes.fromhex(f.encoding)) for f in faces]
person_ids = [f.person.id for f in faces]
palette = color_palette('Paired',max(person_ids)+1).as_hex()
colors = [palette[i] for i in person_ids]

face_embedded = TSNE(n_components=2,n_iter=100000,verbose=1,perplexity=50).fit_transform(face_encodings)
plt.scatter(face_embedded[:,0],face_embedded[:,1],c=colors)
plt.show()
