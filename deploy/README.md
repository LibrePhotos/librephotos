# For common users:
Set the needed variables in .env (take librephotos.env as model)
Just pull the repo and run
docker-compose up -d
This will get the pre-built images and start all the needed processes

# For developers:
Set the needed variables in .evn (take librephotos.env as model)
Also set the codedir variable that tells docker where your source folder are
Pull frontend code into ${codedir}/frontend/
Pull backend code into ${codedir}/backend/
Pull this repo and run
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
This will build images from scratch (can take a long time)
Now you can develop and benefit from code auto reload from both backend and frontend
N.B. If you already built this image once, when you do changes you have to run 

docker-compose build --no-cache frontend
docker-compose build --no-cache backend

based on which one you changed if these changes need rebuild as for added dependencies/libraries etc.