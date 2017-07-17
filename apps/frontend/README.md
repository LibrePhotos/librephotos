# Ownphotos

## What is it?

- Self hosted wannabe Google Photos clone. 
- Django backend & React frontend. 
- In development. 

### Features

#### - Currently implemented:
  - Label some faces manualy, and train a face classifier to label the rest.
  - View photos by people in them.
  - Automatically generate "event" albums generate nice titles, like "Thursday in Berlin"
  - See photos on the map
  - Long loading times with very large photo library (in the order of thousands of photos).

#### - Upcoming

  - short term:
    - View all photos by date
    - Infinite scrolling/dynamic loading
    - favorite albums
    - create custom albums
    - authentication

  - longer term, i.e. haven't thought much about them
    - share photos/albums
    - basic photo editing, like rotation
    - tag undetected face
    - add cool graphs

  - Finally:
    - dockerize

## How do I run it?

Install node v6 and npm v5.

Clone the repo and

```bash
npm install
npm start
```

# Screenshots

![](/screenshots/face-dashboard.png)
![](/screenshots/people-dashboard.png)
![](/screenshots/album-events.png)
![](/screenshots/album-event-gallery.png)
![](/screenshots/album-people.png)
![](/screenshots/album-people-gallery.png)
