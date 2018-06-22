from django.test import TestCase

from rest_framework.test import APIRequestFactory
from rest_framework.test import APIClient
from api.models import *

from api.directory_watcher import scan_photos
from django_rq import get_worker

import config
import ipdb

samplephotos_dir = os.path.abspath('samplephotos')


# Create your tests here.
class AdminTestCase(TestCase):
    def setUp(self):
        config.image_dirs = [samplephotos_dir]
        User.objects.create_superuser('test_admin', 'test_admin@test.com',
                                      'test_password')
        self.client = APIClient()
        auth_res = self.client.post('/api/auth/token/obtain/', {
            'username': 'test_admin',
            'password': 'test_password'
        })
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " +
                                auth_res.json()['access'])

    def test_admin_exists(self):
        test_admin = User.objects.get(username='test_admin')
        self.assertTrue(test_admin.is_superuser)

    def test_admin_login(self):
        res = self.client.post('/api/auth/token/obtain/', {
            'username': 'test_admin',
            'password': 'test_password'
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue('access' in res.json().keys())

    def test_list_directories(self):
        res = self.client.get('/api/dirtree/')
        self.assertEqual(res.status_code, 200)

    def test_get_albums_date_list(self):
        res = self.client.get('/api/albums/date/photohash/list/')
        self.assertEqual(res.status_code, 200)


class UserTestCase(TestCase):
    def setUp(self):
        config.image_dirs = [samplephotos_dir]
        self.client_admin = APIClient()
        self.client_user = APIClient()

        User.objects.create_superuser('test_admin', 'test_admin@test.com',
                                      'test_password')
        admin_auth_res = self.client_admin.post('/api/auth/token/obtain/', {
            'username': 'test_admin',
            'password': 'test_password'
        })
        self.client_admin.credentials(HTTP_AUTHORIZATION="Bearer " +
                                      admin_auth_res.json()['access'])

        # signup disabled by default
        create_user_res = self.client_user.post('/api/user/', {
            'username': 'test_admin',
            'password': 'test_password'
        })
        self.assertEqual(create_user_res.status_code, 400)

        # enable signup as admin
        change_settings_res = self.client_admin.post(
            '/api/sitesettings/', {'allow_registraion': True})
        self.assertEqual(change_settings_res.status_code, 200)

        # normal user is gonna try and set his own scan directory (which isn't allowed)
        forced_scan_directory = '/root/l33t/'

        # try signing up as a normal user again
        create_user_res = self.client_user.post(
            '/api/user/',
            {
                'username': 'test_user',
                'email': 'test_user@test.com',
                'password': 'test_password',
                'scan_directory': forced_scan_directory
                # 'first_name': 'First',
                # 'last_name': 'Last'
            })

        self.assertEqual(create_user_res.status_code, 201)
        self.assertFalse('password' in create_user_res.json().keys())

        # make sure setting his own scan_directory didn't work
        self.assertTrue(
            create_user_res.json()['scan_directory'] != forced_scan_directory)

        test_user_pk = create_user_res.json()['id']

        # login as test_user
        user_auth_res = self.client_user.post('/api/auth/token/obtain/', {
            'username': 'test_user',
            'password': 'test_password'
        })
        self.client_user.credentials(HTTP_AUTHORIZATION="Bearer " +
                                     user_auth_res.json()['access'])

        # make sure the logged in user cannot update his own scan_directory path
        patch_res = self.client_user.patch(
            '/api/user/{}/'.format(test_user_pk),
            {'scan_directory': forced_scan_directory})
        self.assertTrue(
            patch_res.json()['scan_directory'] != forced_scan_directory)

        # make sure get /api/user/ doesn't return password
        res = self.client.get('/api/user/')
        self.assertEqual(res.status_code, 200)
        for r in res.json()['results']:
            self.assertFalse('password' in r.keys(),
                             'Get user returned password')

    def test_get_albums_date_list(self):
        res = self.client_user.get('/api/albums/date/photohash/list/')
        self.assertEqual(res.status_code, 200)


class ScanPhotosTestCase(TestCase):
    def setUp(self):
        config.image_dirs = [samplephotos_dir]
        self.client_admin = APIClient()

        self.client_users = [APIClient() for _ in range(6)]

        User.objects.create_superuser('test_admin', 'test_admin@test.com',
                                      'test_password')
        admin_auth_res = self.client_admin.post('/api/auth/token/obtain/', {
            'username': 'test_admin',
            'password': 'test_password'
        })
        self.client_admin.credentials(HTTP_AUTHORIZATION="Bearer " +
                                      admin_auth_res.json()['access'])

        # enable signup as admin
        change_settings_res = self.client_admin.post(
            '/api/sitesettings/', {'allow_registraion': True})
        self.assertEqual(change_settings_res.status_code, 200)

        logged_in_clients = []

        # sign up 6 test users
        user_ids = []

        for idx, client in enumerate(self.client_users):
            create_user_res = client.post(
                '/api/user/', {
                    'username': 'test_user_{}'.format(idx),
                    'email': 'test_user_{}@test.com'.format(idx),
                    'password': 'test_password',
                })
            self.assertEqual(create_user_res.status_code, 201)
            user_ids.append(create_user_res.json()['id'])

            login_user_res = client.post(
                '/api/auth/token/obtain/', {
                    'username': 'test_user_{}'.format(idx),
                    'password': 'test_password',
                })
            self.assertEqual(login_user_res.status_code, 200)

            client.credentials(HTTP_AUTHORIZATION="Bearer " +
                               login_user_res.json()['access'])
            logged_in_clients.append(client)
        self.client_users = logged_in_clients

        # set scan directories for each user as admin
        for idx, (user_id, client) in enumerate(
                zip(user_ids, self.client_users)):

            user_scan_directory = os.path.join(samplephotos_dir,
                                               'test{}'.format(idx))
            patch_res = self.client_admin.patch(
                '/api/manage/user/{}/'.format(user_id),
                {'scan_directory': user_scan_directory})
            self.assertEqual(patch_res.status_code, 200)
            self.assertEqual(patch_res.json()['scan_directory'],
                             user_scan_directory)

        # make sure users are logged in
        for client in self.client_users:
            res = client.get('/api/photos/')
            self.assertEqual(res.status_code, 200)

#         for client in self.client_users:
#             res = client.get('/api/scanphotos/')
#             self.assertEqual(res.status_code, 200)

# scan photos
        scan_photos_res = self.client_users[0].get('/api/scanphotos/')
        self.assertEqual(scan_photos_res.status_code, 200)
        get_worker().work(burst=True)

        # make sure photos are imported
        get_photos_res = self.client_users[0].get('/api/photos/')
        self.assertEqual(get_photos_res.status_code, 200)
        self.assertTrue(len(get_photos_res.json()['results']) > 0)

        # try scanning again and make sure there are no duplicate imports
        num_photos = len(get_photos_res.json()['results'])
        scan_photos_res = self.client_users[0].get('/api/scanphotos/')
        self.assertEqual(scan_photos_res.status_code, 200)
        get_worker().work(burst=True)
        get_photos_res = self.client_users[0].get('/api/photos/')
        self.assertEqual(get_photos_res.status_code, 200)
        self.assertEqual(len(get_photos_res.json()['results']), num_photos)

    def test_auto_albums(self):
        '''make sure user can make auto albums, list and retrieve them'''
        # make auto albums
        auto_album_gen_res = self.client_users[0].get('/api/autoalbumgen/')
        self.assertEqual(auto_album_gen_res.status_code, 200)
        get_worker().work(burst=True)

        # make sure auto albums are there
        auto_album_list_res = self.client_users[0].get(
            '/api/albums/auto/list/')
        self.assertEqual(auto_album_list_res.status_code, 200)

        # make sure user can retrieve each auto album
        for album in auto_album_list_res.json()['results']:
            auto_album_retrieve_res = self.client_users[0].get(
                '/api/albums/auto/%d/' % album['id'])
            self.assertEqual(auto_album_retrieve_res.status_code, 200)
            self.assertTrue(len(auto_album_retrieve_res.json()['photos']) > 0)

        # try making auto albums again and make sure there are no duplicates
        num_auto_albums = len(auto_album_list_res.json()['results'])

        auto_album_gen_res = self.client_users[0].get('/api/autoalbumgen/')
        self.assertEqual(auto_album_gen_res.status_code, 200)
        get_worker().work(burst=True)

        auto_album_list_res = self.client_users[0].get(
            '/api/albums/auto/list/')
        self.assertEqual(
            len(auto_album_list_res.json()['results']), num_auto_albums)

    def test_place_albums(self):
        '''make sure user can list and retrieve place albums'''
        place_album_list_res = self.client_users[0].get('/api/albums/place/list/')
        self.assertEqual(place_album_list_res.status_code, 200)

        for album in place_album_list_res.json()['results']:
            place_album_retrieve_res = self.client_users[0].get('/api/albums/place/%d/'%album['id'])
            self.assertEqual(place_album_retrieve_res.status_code, 200)

    def test_thing_albums(self):
        '''make sure user can list and retrieve thing albums'''
        thing_album_list_res = self.client_users[0].get('/api/albums/thing/list/')
        self.assertEqual(thing_album_list_res.status_code, 200)

        for album in thing_album_list_res.json()['results']:
            thing_album_retrieve_res = self.client_users[0].get('/api/albums/thing/%d/'%album['id'])
            self.assertEqual(thing_album_retrieve_res.status_code, 200)




#     def test_get_faces(self):
#         res = self.client_users[0].get('/api/faces/list/')
#         self.assertEqual(res.status_code, 200)
#         ipdb.set_trace()
#
#     def test_get_labeled_faces(self):
#         res = self.client_users[0].get('/api/faces/labeled/list/')
#         self.assertEqual(res.status_code, 200)
#
#     def test_get_inferred_faces(self):
#         res = self.client_users[0].get('/api/faces/inferred/list/')
#         self.assertEqual(res.status_code, 200)

#         #75 photos total in the sample photos directory
#         self.assertEqual(Photo.objects.count(), 75)
