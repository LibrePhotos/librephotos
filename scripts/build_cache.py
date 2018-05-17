from requests.auth import HTTPBasicAuth
import datetime
import requests
import ipdb

auth = HTTPBasicAuth('admin','q1W@e3R$')

start = datetime.datetime.now()

print('========== FACES =======================')

resp_faces = requests.get('http://localhost:8000/api/faces/', auth=auth)
print('faces: \t\t\t| %.2f ms'%(resp_faces.elapsed.total_seconds()*1000))

resp_faces_labeled = requests.get('http://localhost:8000/api/faces/labeled/', auth=auth)
print('faces_labeled: \t\t| %.2f ms'%(resp_faces_labeled.elapsed.total_seconds()*1000))

resp_faces_inferred = requests.get('http://localhost:8000/api/faces/inferred/', auth=auth)
print('faces_inferred: \t| %.2f ms'%(resp_faces_inferred.elapsed.total_seconds()*1000))

print('========== AUTO ALBUMS =================')

resp_album_auto = requests.get('http://localhost:8000/api/albums/auto/list/',auth=auth)
print('album_auto_list: \t| %.2f ms'%(resp_album_auto.elapsed.total_seconds()*1000))
for result in resp_album_auto.json()['results']:
	album_id = result['id']
	album_resp = requests.get('http://localhost:8000/api/albums/auto/%d/'%album_id, auth=auth)
	print('album_auto %d: \t\t| %.2f ms'%(album_id, album_resp.elapsed.total_seconds()*1000))

print('========== DATE ALBUMS =================')

resp_album_date = requests.get('http://localhost:8000/api/albums/date/photohash/list/',auth=auth)
print('album_date_list: \t| %.2f ms'%(resp_album_date.elapsed.total_seconds()*1000))
# for result in resp_album_date.json()['results']:
# 	album_id = result['id']
# 	album_resp = requests.get('http://localhost:8000/api/albums/date/%d/'%album_id, auth=auth)
# 	print('album_date %d: \t\t| %.2f ms'%(album_id, album_resp.elapsed.total_seconds()*1000))

print('========== PERSON ALBUMS ===============')

resp_album_person = requests.get('http://localhost:8000/api/albums/person/list/',auth=auth)
print('album_person_list: \t| %.2f ms'%(resp_album_person.elapsed.total_seconds()*1000))
for result in resp_album_person.json()['results']:
	album_id = result['id']
	album_resp = requests.get('http://localhost:8000/api/albums/person/%d/'%album_id, auth=auth)
	print('album_person %d: \t| %.2f ms'%(album_id, album_resp.elapsed.total_seconds()*1000))

print('========== THING ALBUMS ===============')
resp_album_thing = requests.get('http://localhost:8000/api/albums/thing/list/',auth=auth)
print('album_thing_list: \t| %.2f ms'%(resp_album_thing.elapsed.total_seconds()*1000))
for result in resp_album_thing.json()['results']:
	album_id = result['id']
	album_resp = requests.get('http://localhost:8000/api/albums/thing/%d/'%album_id, auth=auth)
	print('album_thing %d: \t| %.2f ms'%(album_id, album_resp.elapsed.total_seconds()*1000))

print('========== PLACE ALBUMS ===============')
resp_album_place = requests.get('http://localhost:8000/api/albums/place/list/',auth=auth)
print('album_place_list: \t| %.2f ms'%(resp_album_place.elapsed.total_seconds()*1000))
for result in resp_album_place.json()['results']:
	album_id = result['id']
	album_resp = requests.get('http://localhost:8000/api/albums/place/%d/'%album_id, auth=auth)
	print('album_place %d: \t| %.2f ms'%(album_id, album_resp.elapsed.total_seconds()*1000))

resp = requests.get('http://localhost:8000/api/clusterfaces',auth=auth) 
print('clusterface: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/socialgraph',auth=auth) 
print('socialgraph: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/searchtermexamples',auth=auth) 
print('searchtermexamples: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/locationsunburst',auth=auth) 
print('locationsunburst: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/locationtimeline',auth=auth) 
print('locationtimeline: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/locclust',auth=auth) 
print('locclust: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/photocountrycounts',auth=auth) 
print('pcc: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/photomonthcounts',auth=auth) 
print('pmc: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))
resp = requests.get('http://localhost:8000/api/wordcloud',auth=auth) 
print('wc: \t| %.2f ms'%(resp.elapsed.total_seconds()*1000))



end = datetime.datetime.now()

album_auto_ids = [res['id'] for res in resp_album_auto.json()['results']]
# album_date_ids = [res['id'] for res in resp_album_date.json()['results']]
album_person_ids = [res['id'] for res in resp_album_person.json()['results']]

print('========================================')
print('len(album_auto): \t| %d albums'%len(album_auto_ids))
# print('len(album_date): \t| %d albums'%len(album_date_ids))
print('len(album_person): \t| %d albums'%len(album_person_ids))
print('========================================')
print('Total elapsed: \t\t| %.2f ms'%((end-start).total_seconds()*1000))
