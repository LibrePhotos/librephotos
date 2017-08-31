# add paths of the directories where your photos live.
# it will not look for photos recursively, so you might want to add subdirectories as well.
import os

image_dirs = [
	'/data',
]

mapzen_api_key = os.environ['MAPZEN_API_KEY']
