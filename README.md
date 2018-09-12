<div style="text-align:center"><img width="100" src ="/screenshots/logo.png"/></div>

# Ownphotos


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
  - Create custom albums
  - Docker ready
  
#### - Upcoming

  - Short term:
    - Share photos/albums

  - Longer term, i.e. haven't thought much about them
    - Basic photo editing, like rotation
    - Tag undetected face
    - Add cool graphs




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




Now we can run the ownphotos container image. There are
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
    --name ownphotos \
    nhooram/ownphotos:0.1
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
    server_name ownphotos-api.example.com;
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
    server_name ownphotos.example.com;
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

