#!/usr/bin/env bash

# Build the Python wheel for this extension into the dist/ folder.

set -euo pipefail

cd ..

python3 -m pip install --upgrade pip
python3 -m pip install --upgrade build "jupyterlab>=4.0.0,<5" \
  hatchling hatch-nodejs-version hatch-jupyter-builder

python3 -m pip install -e .

if command -v npm >/dev/null 2>&1; then
  npm install
fi

export PATH="$(python3 -m site --user-base)/bin:$PATH"

jlpm install
jlpm build
jupyter labextension develop . --overwrite

python3 -m build --wheel --outdir dist
