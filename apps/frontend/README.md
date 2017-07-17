# Ownphotos

## What is it?

- Self hosted wannabe Google Photos clone. 
- React frontend. 
- In development. 
- Long loading times with very large photo library (in the order of thousands of photos).

### Features

#### currently implemented:
  - Label some faces manualy, and train a face classifier to label the rest.
  - View photos by people in them.
  - Automatically generate "event" albums and title generation, like "Thursday in Berlin"
  - See photos on the map

#### upcoming

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

  - Finally:
    - dockerize

## How do i run it?

Install node v6 and npm v5.

Clone repo and run it.

```bash
git clone
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
