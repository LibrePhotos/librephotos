FROM cgr.dev/chainguard/wolfi-base:latest@sha256:43f53fe2a02ba1a9484cc560ccf188da32f4a4b38055752514d78a3923ff05c8 AS perl-brotli

ARG IO_COMPRESS_BROTLI_VERSION=0.023
ARG IO_COMPRESS_BROTLI_SHA256=fb30386115589dbdc71ff3ab0af1b67c33c202df4bbdb4e00093f1c50a2cf2f8

RUN apk add --no-cache build-base cmake curl perl-dev
WORKDIR /src
RUN curl -fsSL -o io-compress-brotli.tar.gz "https://cpan.metacpan.org/authors/id/T/TI/TIMLEGGE/IO-Compress-Brotli-${IO_COMPRESS_BROTLI_VERSION}.tar.gz" && \
    echo "${IO_COMPRESS_BROTLI_SHA256}  io-compress-brotli.tar.gz" | sha256sum -c - && \
    tar -xzf io-compress-brotli.tar.gz --strip-components=1 && \
    mkdir -p /stub/Alien && \
    printf 'package Alien::cmake3;\nsub bin_dir { () }\nsub exe { "cmake" }\n1;\n' > /stub/Alien/cmake3.pm && \
    PERL5LIB=/stub perl Makefile.PL INSTALLDIRS=vendor && \
    make && \
    make install DESTDIR=/out && \
    rm -rf /out/usr/bin /out/usr/share/man && \
    find /out -name .packlist -delete -o -name perllocal.pod -delete

FROM cgr.dev/chainguard/wolfi-base:latest@sha256:43f53fe2a02ba1a9484cc560ccf188da32f4a4b38055752514d78a3923ff05c8 AS mesa-vulkan

ARG SPIRV_LLVM_TRANSLATOR_VERSION=23.1.3
ARG SPIRV_LLVM_TRANSLATOR_SHA256=9ed57de3f31c575c836bef8f05ce5dfa98a8d80e64d948a02aac83c2e124f842
ARG MESA_VERSION=26.3.1
ARG MESA_SHA256=4e4e438eac7b840a9383988cbb7c08dad8041da544b9319fc26d319fa7348961

RUN apk add --no-cache build-base cmake samurai meson pkgconf curl xz bison flex git \
      llvm-23 llvm-23-dev clang-23 libclang-cpp-23 spirv-tools-dev glslang \
      python-3.14 py3.14-mako py3.14-pyyaml py3.14-packaging py3.14-ply libdrm-dev expat-dev zlib-dev zstd-dev libudev-dev
WORKDIR /src
RUN curl -fsSL -o spirv-llvm-translator.tar.gz "https://github.com/KhronosGroup/SPIRV-LLVM-Translator/archive/refs/tags/v${SPIRV_LLVM_TRANSLATOR_VERSION}.tar.gz" && \
    echo "${SPIRV_LLVM_TRANSLATOR_SHA256}  spirv-llvm-translator.tar.gz" | sha256sum -c - && \
    mkdir spirv-llvm-translator && \
    tar -xzf spirv-llvm-translator.tar.gz -C spirv-llvm-translator --strip-components=1 && \
    cmake -S spirv-llvm-translator -B spirv-llvm-translator/build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/spirv \
      -DLLVM_DIR="$(llvm-config --cmakedir)" \
      -DLLVM_SPIRV_INCLUDE_TESTS=OFF -DBUILD_SHARED_LIBS=OFF && \
    cmake --build spirv-llvm-translator/build && \
    cmake --install spirv-llvm-translator/build && \
    rm -rf spirv-llvm-translator spirv-llvm-translator.tar.gz
RUN curl -fsSL -o mesa.tar.xz "https://archive.mesa3d.org/mesa-${MESA_VERSION}.tar.xz" && \
    echo "${MESA_SHA256}  mesa.tar.xz" | sha256sum -c - && \
    mkdir mesa && \
    tar -xJf mesa.tar.xz -C mesa --strip-components=1 && \
    PKG_CONFIG_PATH=/opt/spirv/lib/pkgconfig meson setup mesa/build mesa \
      --prefix=/usr --buildtype=release -Db_ndebug=true \
      -Dvulkan-drivers=intel,intel_hasvk,virtio,asahi -Dgallium-drivers= -Dplatforms= \
      -Dopengl=false -Dgles1=disabled -Dgles2=disabled -Degl=disabled -Dglx=disabled -Dgbm=disabled \
      -Dllvm=enabled -Dshared-llvm=enabled -Dvulkan-layers= -Dtools= -Dvideo-codecs= \
      -Dvalgrind=disabled -Dlibunwind=disabled -Dbuild-tests=false && \
    meson compile -C mesa/build && \
    meson install -C mesa/build --destdir /out && \
    rm /out/usr/share/drirc.d/00-mesa-defaults.conf && \
    rm -rf mesa mesa.tar.xz

FROM cgr.dev/chainguard/wolfi-base:latest@sha256:43f53fe2a02ba1a9484cc560ccf188da32f4a4b38055752514d78a3923ff05c8 AS runtime

RUN apk add --no-cache bash python-3.14 py3.14-pip perl libstdc++ vulkan-loader-libs mesa spirv-tools && \
    mkdir -p /usr/local/bin && \
    ln -sf /usr/bin/python3 /usr/local/bin/python

COPY --from=perl-brotli /out/ /
COPY --from=mesa-vulkan /out/ /
