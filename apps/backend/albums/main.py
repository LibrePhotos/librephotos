from albums.models import Photo

photo = Photo(image_path='data/samplephotos/file1488893931630.jpg')
photo._generate_md5()
photo._generate_thumbnail()
photo._extract_exif()
