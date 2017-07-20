from requests.auth import HTTPBasicAuth
import datetime
import requests
import ipdb

auth = HTTPBasicAuth('admin','q1W@e3R$')

resp_faces = requests.get('http://localhost:8000/api/faces/', auth=auth)
resp_faces_labeled = requests.get('http://localhost:8000/api/faces/labeled/', auth=auth)
resp_faces_inferred = requests.get('http://localhost:8000/api/faces/inferred/', auth=auth)

resp_album_auto = requests.get('http://localhost:8000/api/albums/auto/list/',auth=auth)
resp_album_date = requests.get('http://localhost:8000/api/albums/date/list/',auth=auth)
resp_album_person = requests.get('http://localhost:8000/api/albums/person/list/',auth=auth)

print('faces',resp_faces.elapsed.total_seconds()*1000)
print('faces_labeled',resp_faces_labeled.elapsed.total_seconds()*1000)
print('faces_inferred',resp_faces_inferred.elapsed.total_seconds()*1000)

print('album_auto',resp_album_auto.elapsed.total_seconds()*1000)
print('album_person',resp_album_person.elapsed.total_seconds()*1000)
print('album_date',resp_album_date.elapsed.total_seconds()*1000)

album_auto_ids = [res['id'] for res in resp_album_auto.json()['results']]
album_date_ids = [res['id'] for res in resp_album_date.json()['results']]
album_person_ids = [res['id'] for res in resp_album_person.json()['results']]

print(len(album_auto_ids))
print(len(album_date_ids))
print(len(album_person_ids))

print(datetime.datetime.now())
