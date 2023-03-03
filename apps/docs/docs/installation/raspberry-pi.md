---
title: "🍓 Raspbery Pi Installation"
excerpt: "How to install a premeade image for the  Raspbery Pi "
sidebar_position: 2
---

## LibrePhotosOS

An out of the box [Raspberry Pi](http://www.raspberrypi.org/) distro with [LibrePhotos](https://github.com/LibrePhotos) installed. You can find the [repository from guysoft here](https://github.com/guysoft/LibrePhotosOS).

### 🌟 Features

- [LibrePhotos](https://github.com/LibrePhotos)
- Automatically mounts hard drive attached to Pi and links librephotos to the "librephotos" folder on that drive

### 🗺️ Where to get it?

You can use the [pi-imager](https://github.com/guysoft/pi-imager/releases) commuity raspberrypi imager here, unofficial section.

Or download directly form the official mirror [here](http://unofficialpi.org/Distros/LibrePhotosOS)

### 🚀 How to use it?

- Unzip the image and install it to an SD card [like any other Raspberry Pi image](https://www.raspberrypi.org/documentation/installation/installing-images/README.md)
- Configure your WiFi by editing `LibrePhotosOS-wpa-supplicant.txt` at the root of the flashed card when using it like a flash drive
- Boot the Pi from the SD card
- Hostname is `librephotosos` (not `raspberrypi` as usual), username: `ubuntu` and inital password is: `ubuntu`
- After a few mintues you should be able to access `http://librephotosos.local/` or `http://librephotosos.lan/`
- You can change the settings of the docker settings are located at `/boot/docker-compose/librephotos/`

### ✔️ Requirements

- Raspberrypi 3 and above, needs a 64bit capable pi
- 2A power supply

### 🔨 Developing

Go to the [repository from guysoft](https://github.com/guysoft/LibrePhotosOS) to find more information about it.
