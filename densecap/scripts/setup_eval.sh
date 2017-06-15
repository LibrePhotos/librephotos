cd eval
wget http://www.cs.cmu.edu/~alavie/METEOR/download/meteor-1.5.tar.gz
tar -xzvf meteor-1.5.tar.gz
cp meteor-1.5/meteor-1.5.jar .
mkdir data
cp meteor-1.5/data/paraphrase-en.gz data/
rm -r meteor-1.5
rm meteor-1.5.tar.gz
cd ..
