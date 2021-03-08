# Librephotos

## For common users:
Set the needed variables in `.env` file (take `librephotos.env` as model)

Clone the repo: `git clone git@github.com:LibrePhotos/librephotos-docker.git`

Then launch it: `docker-compose up -d`

This will get the pre-built images and start all the needed processes

## For developers:
Set the needed variables in `.env` file (take `librephotos.env` as model)

Also set the codedir variable that tells docker where your source folder are.

Pull frontend code with `git clone https://github.com/LibrePhotos/librephotos-frontend.git ${codedir}/frontend/`

Pull backend code into `git clone https://github.com/LibrePhotos/librephotos.git ${codedir}/backend/`

Pull this repo and run `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

This will build images from scratch (can take a long time the first time)
Now you can develop and benefit from code auto reload from both backend and frontend
N.B. If you already built this image once, when you do force rebuild you have to run 

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache frontend`

`docker-compose -f docker-compose.yml -f docker-compose.dev.yml  build --no-cache backend`

Based on which one you changed if these changes need rebuild as for added dependencies/libraries etc.

and then the usual `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

If you use vscode you can also benefit auto completion and other goodies. For this just type `code .` in your dockerfile folder.
Vscode will open and ask you if you want to reopen it in the container. If you do it, it will add his server to the docker layers (first time you do it can take a couple of minutes) and you will have the same Python interpreter librephotos is using internally hence the same installed libraries in auto completion and the same development environment will be shared by all devs (isort, flake8 and pylint for example).
