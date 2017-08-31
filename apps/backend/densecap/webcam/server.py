import argparse, random, os, time, json

from PIL import Image
from io import BytesIO
import base64
import requests

import ipdb

from flask import Flask, request, Response
from flask.ext.cors import CORS
from flask_restful import Resource, Api

import numpy as np

app = Flask(__name__)
api = Api(app)
CORS(app)


input_dir = 'webcam/inputs'
output_dir = 'webcam/outputs'

def f7(seq):
    seen = set()
    seen_add = seen.add
    return [x for x in seq if not (x in seen or seen_add(x))]

def root_dir():  # pragma: no cover
    return os.path.abspath(os.path.dirname(__file__))

def get_file(filename):  # pragma: no cover
    try:
        src = os.path.join(root_dir(), filename)
        # Figure out how flask returns static files
        # Tried:
        # - render_template
        # - send_file
        # This should not be so non-obvious
        return open(src).read()
    except IOError as exc:
        return str(exc)

def decode_base64(data):
    """Decode base64, padding being optional.

    :param data: Base64 data as an ASCII byte string
    :returns: The decoded byte string.

    """
    missing_padding = len(data) % 4
    if missing_padding != 0:
        data += '='* (4 - missing_padding)
    return data


class ShortCaptions(Resource):
  def get(self):
    return Response('Method not allowed',mimetype='text/html')
  def post(self):
    try:
      img_id = random.randint(1, 1000000)
      img_name = os.path.join(input_dir, '%d.jpg' % img_id)

      # Get the base64 image data out of the request.
      # for some reason Flask doesn't parse this out at all for use, so we'll just
      # do it manually. There is a prefix telling us that this is an image and the
      # type of the image, then a comma, then the raw base64 data for the image.
      # We just grab the part after the comma and decode it.
  #     ipdb.set_trace()
#       ipdb.set_trace()  
      data = request.data
      # data = decode_base64(data)
      # data = data.replace("'",'').split(',')[1]
      img_data = data

      im = Image.open(BytesIO(base64.b64decode(img_data)))
      im.save(img_name)

      # request.files['image'].save(img_name)
      json_name = os.path.join(output_dir, '%d.json' % img_id)
      while not os.path.isfile(json_name):
        time.sleep(0.05)
      with open(json_name, 'r') as f:
        ann = json.load(f)
      os.remove(json_name)
      outlist = f7(ann['captions'])

      out = {}
      out['status'] = True
      out['data'] = outlist
    except Exception as e:
      out = {}
      out['status'] = False
      out['message'] = e.message
    return out


api.add_resource(ShortCaptions, '/')

if __name__ == '__main__':
  from tornado.wsgi import WSGIContainer
  from tornado.httpserver import HTTPServer
  from tornado.ioloop import IOLoop

  http_server = HTTPServer(WSGIContainer(app))
#   http_server = HTTPServer(WSGIContainer(app), ssl_options={
#     'certfile': 'webcam/ssl/server.crt',
#     'keyfile': 'webcam/ssl/server.key'
#   })

  http_server.listen(5000)

  # We have to do a little weirdness to make the server actually die
  # when we hit CTRL+C
  try:
    IOLoop.instance().start()
  except KeyboardInterrupt:
    IOLoop.instance().stop()
