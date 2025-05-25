#!/usr/bin/env python
import os
import sys
import django

# Add the project directory to the Python path
sys.path.append('/code')

# Set up Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'librephotos.settings')
django.setup()

from api.models import Photo, AlbumDate, User, File
from django.core.paginator import Paginator
from django.db.models import Prefetch

def test_album_date_query():
    """Test the exact query that was failing in the album date endpoint"""
    try:
        user = User.objects.first()
        if not user:
            print("No users found")
            return
            
        album_date = AlbumDate.objects.first()
        if not album_date:
            print("No album dates found")
            return
            
        # Test the exact query that was failing
        photo_qs = (
            album_date.photos.all()
            .prefetch_related(
                Prefetch(
                    "owner",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                ),
                Prefetch(
                    "main_file__embedded_media",
                    queryset=File.objects.only("hash"),
                ),
            )
            .select_related("search_instance")
            .order_by("-exif_timestamp")
            .only(
                "image_hash",
                "thumbnail__aspect_ratio",
                "video",
                "main_file",
                "search_instance__search_location",
                "thumbnail__dominant_color",
                "public",
                "rating",
                "hidden",
                "exif_timestamp",
                "owner",
                "video_length",
            )
        )
        
        # Test pagination
        paginator = Paginator(photo_qs, 100)
        page = paginator.page(1)
        print(f"Success! Found {len(page)} photos in page 1 of {paginator.num_pages} pages")
        print(f"Total count: {paginator.count}")
        
        # Test accessing search_location property
        if page:
            first_photo = page[0]
            print(f"First photo search_location: {first_photo.search_location}")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_album_date_query() 