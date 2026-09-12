#!/bin/bash

set -e

cd "$(dirname "$0")"

source .venv/bin/activate

export TMPDIR="$PWD/.runtime/tmp"
export PIP_CACHE_DIR="$PWD/.runtime/pip-cache"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.runtime/playwright"
export XDG_CACHE_HOME="$PWD/.runtime/cache"

python run.py -c "$PWD/config.yml"
