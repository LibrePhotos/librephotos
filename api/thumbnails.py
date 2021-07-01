import pyvips
import os
import ownphotos.settings
from api.util import logger
import subprocess

def createThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    x = pyvips.Image.thumbnail(inputPath, 10000, height=outputHeight, size=pyvips.enums.Size.DOWN)
    completePath = os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType).strip()
    x.write_to_file(completePath)
    return completePath

def createAnimatedThumbnail(inputPath, outputHeight, outputPath, hash, fileType):
    output = os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + fileType).strip()
    subprocess.call(['ffmpeg', '-i', inputPath, '-to', '00:00:05', '-vcodec', 'libx264', '-crf', '20', '-an', '-filter:v', ('scale=-2:' + str(outputHeight)), output])

def doesThumbnailExists(outputPath, hash):
    return os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + ".webp").strip()) or os.path.exists(os.path.join(ownphotos.settings.MEDIA_ROOT, outputPath, hash + ".mp4").strip())