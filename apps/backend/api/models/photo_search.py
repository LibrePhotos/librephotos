from django.db import models

import api.models
from api import util


class PhotoSearch(models.Model):
    """Model for handling photo search functionality"""
    
    photo = models.OneToOneField(
        'Photo', 
        on_delete=models.CASCADE, 
        related_name='search_instance', 
        primary_key=True
    )
    search_captions = models.TextField(blank=True, null=True, db_index=True)
    search_location = models.TextField(blank=True, null=True, db_index=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'api_photo_search'

    def __str__(self):
        return f"Search data for {self.photo.image_hash}"

    def recreate_search_captions(self):
        """Recreate search captions from all caption sources"""
        search_captions = ""

        # Get captions from the PhotoCaption model
        if hasattr(self.photo, 'caption_instance') and self.photo.caption_instance:
            captions_json = self.photo.caption_instance.captions_json
            if captions_json:
                places365_captions = captions_json.get("places365", {})

                attributes = places365_captions.get("attributes", [])
                search_captions += " ".join(attributes) + " "

                categories = places365_captions.get("categories", [])
                search_captions += " ".join(categories) + " "

                environment = places365_captions.get("environment", "")
                search_captions += environment + " "

                user_caption = captions_json.get("user_caption", "")
                if user_caption:
                    search_captions += user_caption + " "

                im2txt_caption = captions_json.get("im2txt", "")
                if im2txt_caption:
                    search_captions += im2txt_caption + " "

        # Add face/person names
        for face in api.models.face.Face.objects.filter(photo=self.photo).all():
            if face.person:
                search_captions += face.person.name + " "

        # Add file paths
        for file in self.photo.files.all():
            search_captions += file.path + " "

        # Add media type
        if self.photo.video:
            search_captions += "type: video "

        # Add camera and lens info
        if self.photo.camera:
            search_captions += self.photo.camera + " "

        if self.photo.lens:
            search_captions += self.photo.lens + " "

        self.search_captions = search_captions.strip()
        
        util.logger.debug(
            f"Recreated search captions for image {self.photo.image_hash}."
        )

    def update_search_location(self, geolocation_json):
        """Update search location from geolocation data"""
        if geolocation_json and "address" in geolocation_json:
            self.search_location = geolocation_json["address"]
        elif geolocation_json and "features" in geolocation_json:
            # Handle features format used in tests
            features = geolocation_json["features"]
            location_parts = [feature.get("text", "") for feature in features if feature.get("text")]
            self.search_location = ", ".join(location_parts) if location_parts else ""
        else:
            self.search_location = ""
        
        util.logger.debug(
            f"Updated search location for image {self.photo.image_hash}: {self.search_location}"
        ) 