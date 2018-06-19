from django.test import TestCase

from rest_framework.test import APIRequestFactory
from rest_framework.test import APIClient
from api.models import *
import config
import ipdb


# Create your tests here.
class AdminTestCase(TestCase):
    def setUp(self):
        config.image_dirs = ['/home/hooram/Nextcloud/Photos/tuebingen']
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
        config.image_dirs = ['/home/hooram/Nextcloud/Photos/tuebingen']
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
        self.assertTrue(create_user_res.status_code, 401)

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
        user_auth_res = self.client_admin.post('/api/auth/token/obtain/', {
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
