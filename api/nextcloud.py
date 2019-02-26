from api.models import *
import owncloud as nextcloud
import ipdb
import time

def login(user):
    nc = nextcloud.Client(user.nextcloud_server_address)
    nc.login(user.nextcloud_username, user.nextcloud_app_password)

    def path_to_dict(path):
        d = {'title': os.path.basename(path), 'absolute_path': path}
        try:
            d['children'] = [
                path_to_dict(os.path.join(path, x.path)) for x in nc.list(path)
                if x.is_dir()
            ]
        except:
            pass

        return d



def list_dir(user,path):
    nc = nextcloud.Client(user.nextcloud_server_address)
    nc.login(user.nextcloud_username, user.nextcloud_app_password)
    return [p.path for p in nc.list(path) if p.is_dir()]
    


