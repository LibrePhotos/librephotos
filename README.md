# Ownphotos

## What is it?

- Self hosted wannabe Google Photos clone, with a slight focus on cool graphs
- Django backend & React frontend. 
- In development. 

**Currently the project is in very early stages (e.g. default username/password, server hostname/ip for backend is baked into the frontend code), so run it only for the sake of checking it out.**

### Features


#### - Currently implemented:
  
  - Label some faces manualy, and train a face classifier to label the rest.
  - View photos by people in them.
  - Automatically generate "event" albums with nice titles, like "Thursday in Berlin"
  - See photos on the map
  - Long loading times with very large photo library (in the order of thousands of photos).

#### - Upcoming

  - Short term:
    - View all photos by date
    - Infinite scrolling/dynamic loading
    - Favorite albums
    - Create custom albums
    - Authentication
    - Detect objects in photos, and make them searchable by objects

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
- **Object detection:** [densecap](https://github.com/jcjohnson/densecap)


## How do I run it?

Tested on Ubuntu 16.04 and macOS Sierra.

### Backend


Make sure you have Python version >= 3.5. 

**Install Boost.**

*For Ubuntu*
```bash
sudo apt-get install libboost-all-dev
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
git clone git clone https://github.com/hooram/ownphotos-backend.git
cd ownphotos-backend
pip install -r requirements.txt
```

**Create db and add admin user with username `admin` and password `q1W@e3R$`**

```bash
python manage.py migrate
python manage.py migrate --run-syncdb
python manage.py createsuperuser # will prompt for username and password. use admin/password
```

**Edit `config.py` file to add directories where your photos live** (ignores subfolders).

**Manually run the script to load the photos into the db**

```bash
python manage.py shell # will drop you into ipython shell
from api.directory_watcher import scan_photos
scan_photos() # this might take a while depending on the number of photos
```

**Start the server process** (make sure it's running on port 8000, or go through the entire front end code to replace occurances of `localhost:8000` with the appropriate `hostname:port`)

```bash
python manage.py runserver
```


### Frontend

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

![](/screenshots/face-dashboard.png)
![](/screenshots/people-dashboard.png)
![](/screenshots/album-events.png)
![](/screenshots/album-event-gallery.png)
![](/screenshots/album-people.png)
![](/screenshots/album-people-gallery.png)
