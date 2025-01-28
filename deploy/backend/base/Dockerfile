# Stage 1: Build Stage
FROM ubuntu:noble AS builder
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive

# Install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade --break-system-packages --ignore-installed pip \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# System packages installation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
		build-essential \
		bzip2 \
		brotli \
		curl \
		ffmpeg \
		git \
  		libltdl-dev \
		libboost-all-dev \
		libcfitsio-dev \ 
		libexif-dev \
		libexpat-dev \
		libexpat1-dev \ 
		libgif-dev \
		libglib2.0-dev \
		libgsf-1-dev \ 
		libheif-dev \
		libimage-exiftool-perl \
		libimagequant-dev \
		libjpeg-dev \
		liblapack-dev \
		liblcms2-dev \
		libmagic1 \
		libopenblas-dev \
		libopenexr-dev \ 
		liborc-dev \
		libpng-dev \
		libpq-dev \
		librsvg2-dev \
		libsm6 \
		libtiff5-dev \ 
		libtool \ 
		libtool-bin \
		libwebp-dev \
		libxrender-dev \
  		libpoppler-glib-dev \
		libtiff-dev \
		libfftw3-dev \
		libpng-dev \
		libcfitsio-dev \
		libnifti-dev \
		libopenslide-dev \
		libopenexr-dev \
		libmatio-dev \
		libmagickcore-dev \
		libmagickwand-dev \
		libjxl-dev \
		pkg-config \ 
		libjxl-dev \
		libvips-dev \
  		libc6-dev \
    		cmake \
      		libraw-dev \
		libbz2-dev \
        	libzip-dev \
		swig && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install ExifTool
WORKDIR /tmp/exiftool
RUN curl -SL https://exiftool.org/Image-ExifTool-13.16.tar.gz | tar -xz && \
    cd Image-ExifTool-13.16 && \
    perl Makefile.PL && \
    make install && \
    rm -rf /tmp/exiftool

# Build and install ImageMagick
WORKDIR /tmp/builds
ARG IMAGEMAGICK_VERSION=7.1.1-40
RUN curl -SL https://imagemagick.org/archive/releases/ImageMagick-${IMAGEMAGICK_VERSION}.tar.xz | tar -xJf- && \
	cd ImageMagick-${IMAGEMAGICK_VERSION} && \
	./configure --with-modules && \
	make install && \
	ldconfig /usr/local/lib && \
    rm -rf /tmp/builds/*

# Build and install dlib
WORKDIR /tmp/builds
RUN git clone --depth 1 --branch 'master' https://github.com/davisking/dlib.git && \
    mkdir dlib/build && \
    cd dlib/build && \
    cmake .. -DLIB_USE_CUDA=0 -DUSE_AVX_INSTRUCTIONS=0 -DLIB_NO_GUI_SUPPORT=0 && \
    cmake --build . && \
    cd /tmp/builds/dlib && \
    python3 setup.py install --no USE_AVX_INSTRUCTIONS --no DLIB_USE_CUDA --no USE_SSE4_INSTRUCTIONS && \
    rm -rf /tmp/builds/*

# Find the dlib egg file and store its name in a file
RUN find /usr/local/lib/python3.*/dist-packages -name "dlib-*.egg" -exec basename {} \; > /dlib_egg_name.txt

# Stage 2: Deployment Stage
FROM ubuntu:noble
ARG TARGETPLATFORM
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# Install python
RUN apt-get update \
  && apt-get install -y python3-pip python3-dev \
  && cd /usr/local/bin \
  && ln -s /usr/bin/python3 python \
  && pip3 install --upgrade --break-system-packages --ignore-installed pip \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install minimal required libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    git \
    libvips-dev \
    libjpeg-dev \
    libgif-dev \
    libpng-dev \
    libtiff5-dev \
    libwebp-dev \
    libopenblas-dev \
    libheif-dev \
    libjxl-dev \
    libpq-dev \
    libmagic1 \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install PyTorch (CPU version)
RUN pip3 install --no-cache-dir --break-system-packages torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu

# Copy the dlib egg file name from the builder stage
COPY --from=builder /dlib_egg_name.txt /dlib_egg_name.txt
# Read the dlib egg file name and copy the egg file
RUN DLIB_EGG_NAME=$(cat /dlib_egg_name.txt) && \
    COPY --from=builder /usr/local/lib/python3.12/dist-packages/${DLIB_EGG_NAME} /usr/local/lib/python3.12/dist-packages/

# Copy only required components from the builder stage
COPY --from=builder /usr/local/lib/libMagick* /usr/local/lib/
COPY --from=builder /usr/local/lib/libmagic* /usr/local/lib/
COPY --from=builder /usr/local/lib/libraw* /usr/local/lib/
COPY --from=builder /usr/local/bin/magick /usr/local/bin


# Debug Python environment and dlib installation
RUN python3 --version && \
    which python3 && \
    python3 -m site && \
    python3 -c "import sys; print('Python executable:', sys.executable)" && \
    python3 -c "import dlib; print('dlib version:', dlib.__version__)" || \
    echo "dlib not found"

# Create fake dist info for dlib
RUN mkdir -p /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info && \
    echo "Metadata-Version: 2.1\nName: dlib\nVersion: 19.24.99\n" > /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/METADATA && \
    echo "INSTALLER: pip\n" > /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/INSTALLER && \
    touch /usr/local/lib/python3.12/dist-packages/dlib-19.24.99.dist-info/RECORD

# Debugging: Ensure dlib is installed
RUN python -m pip show dlib || echo "dlib not found"

# Update dynamic linker cache
RUN ldconfig /usr/local/lib
