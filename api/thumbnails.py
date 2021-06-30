import pyvips
import os
import ownphotos.settings
from api.util import logger

def createThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    logger.info("Create thumbnail of: " + inputPath)
    x = pyvips.Image.thumbnail(inputPath, 10000, height=outputHeight)
    completePath = os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType).strip()
    x.write_to_file(completePath)
    return completePath