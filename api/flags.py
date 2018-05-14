FLAG_IS_PHOTOS_BEING_ADDED = False
FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED = False

NUM_PHOTOS_TO_ADD = 0
NUM_PHOTOS_ADDED = 0

def is_auto_albums_being_processed():
    global FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED
    return {
        "status":FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED
    }

def set_auto_album_processing_flag_on():
	global FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED
	FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED = True

def set_auto_album_processing_flag_off():
	global FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED
	FLAG_IS_AUTO_ALBUMS_BEING_PROCESSED = False


def is_photos_being_added():
    global FLAG_IS_PHOTOS_BEING_ADDED
    return {
        'status':FLAG_IS_PHOTOS_BEING_ADDED,
        "to_add":NUM_PHOTOS_TO_ADD,
        "added":NUM_PHOTOS_ADDED
    }

def set_photo_scan_flag_on(num_photos_to_add):
    global FLAG_IS_PHOTOS_BEING_ADDED
    global NUM_PHOTOS_TO_ADD 
    NUM_PHOTOS_TO_ADD = num_photos_to_add
    FLAG_IS_PHOTOS_BEING_ADDED = True

def set_num_photos_added(num_photos_added):
    global NUM_PHOTOS_ADDED
    NUM_PHOTOS_ADDED = num_photos_added

def set_photo_scan_flag_off():
    global FLAG_IS_PHOTOS_BEING_ADDED
    global NUM_PHOTOS_TO_ADD
    global NUM_PHOTOS_ADDED
    NUM_PHOTOS_TO_ADD = 0
    NUM_PHOTOS_ADDED = 0
    FLAG_IS_PHOTOS_BEING_ADDED = False