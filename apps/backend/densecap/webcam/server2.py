import argparse, random, os, time, json

from PIL import Image
from io import BytesIO
import base64

from flask import Flask, request
from flask.ext.cors import CORS
from flask_restful import Resource, Api

import ipdb

app = Flask(__name__)
app.config['DEBUG'] = True


ext2conttype2 = {
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "png": "PNG",
    "gif": "GIF",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF"
}


ext2conttype = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif"
}

input_dir = 'webcam/inputs'
output_dir = 'webcam/outputs'


@app.route('/media/upload',methods=['POST','GET'])
def densecap():
    if request.method=='POST':
        ipdb.set_trace()
        file = request.files['file']
        if file and file.filename:
            img_id = random.randint(1,1000000)
            img_path = os.path.join(input_dir, '%d.jpg' % img_id)
            filename = file.filename
            extension = filename[filename.rfind(".")+1:].lower()
            content_type = ext2conttype[extension]
            image = Image.open(file)
            image.save(img_path)

            json_name = os.path.join(output_dir, '%d,json' % img_id)
            while not os.path.isfile(json_name):
                time.sleep(0.05)
            with open(json_name, 'r') as f:
                ann = json.load(f)
            os.remove(json_name)
            return ann
        else:
            return 'error 2'
    else:
        return 'running'





class DenseCap(Resource):
  def get(self):
    return 'The DenseCap server seems to be running!'

  def post(self):
    img_id = random.randint(1, 1000000)
    img_name = os.path.join(input_dir, '%d.jpg' % img_id)

    # Get the base64 image data out of the request.
    # for some reason Flask doesn't parse this out at all for use, so we'll just
    # do it manually. There is a prefix telling us that this is an image and the
    # type of the image, then a comma, then the raw base64 data for the image.
    # We just grab the part after the comma and decode it.
    idx = request.data.find(',') + 1
    img_data = request.data[idx:]
    
    im = Image.open(BytesIO(base64.b64decode(img_data)))
    im.save(img_name)

    # request.files['image'].save(img_name)
    json_name = os.path.join(output_dir, '%d.json' % img_id)
    while not os.path.isfile(json_name):
      time.sleep(0.05)
    with open(json_name, 'r') as f:
      ann = json.load(f)
    os.remove(json_name)
    return ann



if __name__ == '__main__':
    app.run(debug=True)
#   from tornado.wsgi import WSGIContainer
#   from tornado.httpserver import HTTPServer
#   from tornado.ioloop import IOLoop
# 
#   http_server = HTTPServer(WSGIContainer(app), ssl_options={
#     'certfile': 'webcam/ssl/server.crt',
#     'keyfile': 'webcam/ssl/server.key'
#   })
# 
#   http_server.listen(5000)
# 
#   # We have to do a little weirdness to make the server actually die
#   # when we hit CTRL+C
#   try:
#     IOLoop.instance().start()
#   except KeyboardInterrupt:
#     IOLoop.instance().stop()
 
