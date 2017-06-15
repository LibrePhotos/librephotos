# Download the VGG-16 model
mkdir -p data/models/vgg-16
cd data/models/vgg-16
wget https://gist.github.com/ksimonyan/211839e770f7b538e2d8#file-vgg_ilsvrc_16_layers_deploy-prototxt
wget http://www.robots.ox.ac.uk/~vgg/software/very_deep/caffe/VGG_ILSVRC_16_layers.caffemodel
cd ../../..
