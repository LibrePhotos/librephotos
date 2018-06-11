<div style="text-align:center"><img width="100" src ="/screenshots/logo.png"/></div>

# Ownphotos

[DEMO](https://demo.ownphotos.io)

- ID: demo
- Password: demo1234

## What is it?

- Self hosted wannabe Google Photos clone, with a slight focus on cool graphs
- Django backend & React frontend. 
- In development. 

**Currently the project is in very early stages, so run it only for the sake of checking it out.**

### Features

#### - Currently implemented:
  
  - Label some faces manually, and train a face classifier to label the rest.
  - View photos by people in them.
  - Automatically generate "event" albums with nice titles, like "Thursday in Berlin"
  - See photos on the map
  - Backend caching
  - View photos grouped by date
  - "Optimized" frontend (react virtualized... I tried my best.)
  - Detect objects in photos, and make them searchable by objects 
  - Search photos by the location 
  - Authentication (using JWT)


#### - Upcoming

  - Short term:
    - Create custom albums

  - Longer term, i.e. haven't thought much about them
    - Share photos/albums
    - Basic photo editing, like rotation
    - Tag undetected face
    - Add cool graphs

  - Finally:
    - dockerize


## What does it use?

- **Face detection:** [face_recognition](https://github.com/ageitgey/face_recognition) 
- **Face classification/clusterization:** scikit-learn
- **Object detection:** [densecap](https://github.com/jcjohnson/densecap), [places365](http://places.csail.mit.edu/)
- **Reverse geocoding:** [Mapbox](https://www.mapbox.com/): You need to have an API key. First 50,000 geocode lookups are free every month.


## How do I run it?

### Docker

Ownphotos comes with separate backend and frontend
servers. The backend serves the restful API, and the frontend serves, well,
the frontend. The easiest way to do it is using Docker.

Let's say you want the backend server to be reachable by
`ownphotos-api.example.com` and the frontend by `ownphotos.example.com` from
outside. On your browser, you will want to connect to the frontend, so 
`ownphotos.example.com` will be the one you will point your browser to. 

First, run cache (redis) and database (postgresql) containers. Please be mindful
of the `POSTGRES_PASSWORD` environment variable being passed into the db
container and change it.

```
docker run \ 
    --restart always \
    --name ownphotos-db \
    -e POSTGRES_PASSWORD=CHANGE_ME_DB_PASS \
    -e POSTGRES_DB=ownphotos \
    -d postgres

docker run \
    --restart always \
    --name ownphotos-redis \
    -d redis
```


Next, we are going to build the container image. Clone the repo.

```
git clone https://github.com/hooram/ownphotos-backend.git
cd ownphotos-backend
```

And build the docker image:


```
docker build -t ownphotos-backend .
```

Now that we have a docker container image, we can run the container. There are
several options you need to specify.

- Where your photos live on the host machine.
- Where you want the thumbnails and face images to live on the host machine.
  Ownphotos will make fullsize copies, thumbnails of all your images, and cropped faces for serving, so you
  will need quite a lot of storage space on your host machine if you have a big library.
- `SECRET_KEY`: Secret key for django. Generate some random string and use that.
- `ADMIN_EMAIL`,`ADMIN_USERNAME`,`ADMIN_PASSWORD`: Your admin credentials. This is what you will use to log in.
- `DB_PASS`: The one that you specified when running the database container from above.
- `MAPBOX_API_KEY`: Your Mapbox API key. You can sign up for free on mapbox.com and get one there.
- `BACKEND_HOST`: The domain name the backend API server will be reachable from.
  In our case, it's `ownphotos-api.example.com`. 
- Port 80 on the container is for the backend. For this example, we will map it
  to port 8000 on the host machine.
- Port 3000 on the container is for the frontend. For this example, we will map
  it to port 8001 on the host machine.


```
docker run \
    -v /where/your/photos/live/on/host:/data \
    -v /place/to/store/thumbnails/and/faces/and/fullsize/copy/on/host:/code/media \
    --link ownphotos-db:ownphotos-db \
    --link ownphotos-redis:ownphotos-redis \
    -e SECRET_KEY=CHANGE_ME \
    -e ADMIN_EMAIL=CHANGE_ME \
    -e ADMIN_USERNAME=CHANGE_ME \
    -e ADMIN_PASSWORD=CHANGE_ME \
    -e DEBUG=false \
    -e DB_BACKEND=postgresql \
    -e DB_NAME=ownphotos \
    -e DB_USER=postgres \
    -e DB_PASS=CHANGE_ME_DB_PASS \
    -e DB_HOST=ownphotos-db \
    -e DB_PORT=5432 \
    -e REDIS_HOST=ownphotos-redis \
    -e REDIS_PORT=6379 \
    -e MAPBOX_API_KEY=CHANGE_ME \
    -e BACKEND_HOST=CHANGE_ME \
    -p 8000:80 \
    -p 8001:3000 \
    --name ownphotos-backend \
    ownphotos-backend
```

Wait a bit until everything warms up (migrations, and buildling frontend).

Next, you need to configure the webserver on your host machine for proxy. If
you're using nginx, 

Add the following to your nginx configurations. Make sure to change the
`server_name` parameters for both the backend and frontend to suit your needs!
If you want to use https, you probably know what you need to do. If you do
though, make sure http requests get redirected to https. It's important!


```
server {
    # the port your site will be served on
    listen      80;
    server_name ownphotos-api.example.com 127.0.0.1;   # substitute by your FQDN and
machine's IP address
    charset     utf-8;

    #Max upload size
    client_max_body_size 75M;   # adjust to taste

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}


server {
    # the port your site will be served on
    listen      80;
    server_name ownphotos.example.com 127.0.0.1;   # substitute by your FQDN and
machine's IP address
    charset     utf-8;

    #Max upload size
    client_max_body_size 75M;   # adjust to taste


    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```


Restart nginx

```
sudo service nginx restart
```

Point your browser to the frontend domain name!


### Witout Docker (outdated.. See `Dockerfile` & `entrypoint.sh`)

#### Backend

Tested on Ubuntu 16.04 and macOS Sierra.


**See `Dockerfile`. This should have most of the information you need. You might need to pip install some python packages that are not included in the requirements.txt (sorry about that).**



Make sure you have Python version >= 3.5. 

**Install Boost.**

*For Ubuntu*
```bash
sudo apt-get install libboost-all-dev cmake docker.io docker-compose
```

*For macOS*
```bash
brew install boost-python --with-python3 --without-python
```

**Create and activate a python virtual environment**


```bash
sudo apt install python-pip
pip install virtualenv
cd && mkdir venvs
virtualenv -p /usr/bin/python3 ~/venvs/ownphotos 
source ~/venvs/ownphotos/bin/activate
```

**Install dlib and its Python binding** (make sure you're within the above virtual environment)


```bash
git clone https://github.com/davisking/dlib.git
cd dlib
mkdir build; cd build; cmake .. -DDLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=1;
cmake --build .
cd ..
python3 setup.py install --yes USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA
```

**Clone the repo and install requirements**

```bash
cd
git clone https://github.com/hooram/ownphotos-backend.git
cd ownphotos-backend
pip install -r requirements.txt
```

**Setup PostgreSQL database:**

Just use docker

```
docker run --name ownphotos-db -e POSTGRES_PASSWORD=q1W@e3R$ -e POSTGRES_DB=ownphotos -d postgres
```
Check the ip of the postgresql docker container by 

```
docker inspect ownphotos-db | grep IPAddress
```

Should be something like 172.17.0.#. Open `ownphotos/settings.py` and change the db host to that ip in the `DATABASE` dictionary. Should be around line 100 or so.

**Setup redis:**

Also just use docker

```
docker run --name ownphotos-redis -d redis
```

Check the ip of the redis Docker container by

```
docker inspect ownphotos-redis | grep IPAddress
```

Again, should be something like 172.17.0.#. Open `ownphotos/settings.py` and change the hostname in the `CACHES` dictionary. Should be around line 120 or so. 

**Create db and add admin user**

```bash
python manage.py migrate --run-syncdb
python manage.py createsuperuser # will prompt for username and password. use admin/password
```

**Edit `config.py` file to add directories where your photos live**


**(Optional) Install & run densecap**

Follow the instructions [here](/densecap/README.md). You can use CUDA if you want, which will speed up caption generation considerably. On CPU (i7-4765T), generating captions for one photo takes ~10 seconds. On a GPU (gtx970), it takes ~4 seconds per each photo. 

Densecap itself is written in torch, and the script `densecap/webcam/daemon.th` will start the daemon. The script watches a directory for image files in `densecap/webcam/input`, and it will drop a json file containing the captions for image files in the said photos into `densecap/webcam/output`. There's a flask server that deals with communicating with the django backend for receiving base64 encoded image files, and drops it into the `densecap/webcam/input` folder, and returns the captions back to the django backend. It's kind of a convoluted way to do it, but works for now. To run it, 

```
cd densecap/
th webcam/daemon.lua & python webcam/server.py

```

The flask server will listen on port 5000. The only request you can make is POST to `/` with the request body consisting of base64 encoded image file.



**Download and install the model files for places365 pretrained model**

https://drive.google.com/open?id=1Zbe4NcwocGtZ7l7naGKnn7HorMeLejJU
Unzip the contents into `api/places365/model/`.


**Install Spacy default english model**
```
python -m spacy download en_core_web_sm
```



**Start the server process** (make sure it's running on port 8000, or go through the entire front end code to replace occurances of `localhost:8000` with the appropriate `hostname:port`)

```bash
python manage.py runserver
```




#### Frontend

Install node and npm. For development I am using node v6.11.0 and npm v5.1.0.

Clone the repo, `cd` into it and start server

```bash
cd && git clone https://github.com/hooram/ownphotos-frontend.git
cd ownphotos-frontend
npm install
npm start
```

A browser window should open, where you can mess around!

# Screenshots

![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/01.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/02.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/03.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/04.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/05.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/06.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/07.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/08.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/09.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/10.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/11.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/12.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/13.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/14.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/15.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/16.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/17.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/18.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/19.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/20.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/21.png)
![](https://s3.eu-central-1.amazonaws.com/ownphotos-deploy/ownphotos_screenshots/22.png)
