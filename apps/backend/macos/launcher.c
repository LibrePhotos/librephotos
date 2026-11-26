#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *const BINARY = "../Resources/librephotos/librephotos";

int main(int argc, char *argv[]) {
    char own[PATH_MAX];
    uint32_t size = sizeof(own);
    if (_NSGetExecutablePath(own, &size) != 0) {
        fprintf(stderr, "LibrePhotos Server: its own path is too long\n");
        return 127;
    }
    char resolved[PATH_MAX];
    if (realpath(own, resolved) == NULL) {
        perror("LibrePhotos Server");
        return 127;
    }
    char folder[PATH_MAX];
    strlcpy(folder, dirname(resolved), sizeof(folder));
    char target[PATH_MAX];
    if (snprintf(target, sizeof(target), "%s/%s", folder, BINARY) >= (int)sizeof(target)) {
        fprintf(stderr, "LibrePhotos Server: the program path is too long\n");
        return 127;
    }
    char binary[PATH_MAX];
    if (realpath(target, binary) == NULL) {
        perror(target);
        return 127;
    }
    argv[0] = binary;
    (void)argc;
    execv(binary, argv);
    perror(binary);
    return 127;
}
