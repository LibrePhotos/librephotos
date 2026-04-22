#!/usr/bin/env bash

# In the monorepo dev flow the mounted volume is apps/frontend, which is not
# itself a git repo root — silence git and fall back to a placeholder hash.
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
export GIT_HASH

echo "installing frontend"
FORCE_COLOR=true yarn install | cat
FORCE_COLOR=true yarn start | cat
