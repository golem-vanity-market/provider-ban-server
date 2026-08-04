#!/bin/bash

set -x

# Optional local overrides (gitignored): HIDDEN_PATH, API_BASE
if [ -f .deploy.env ]; then
  source .deploy.env
fi
HIDDEN_PATH="${HIDDEN_PATH:-VzMrgjHVl}"
API_BASE="${API_BASE:-/nmpdmxzhrm/ban-server}"

bun install

# Build the UI for the hidden path and copy it to the webroot
VITE_BASE="/${HIDDEN_PATH}/" VITE_API_BASE="${API_BASE}" bun run build
sudo rm -fr "/var/www/html/${HIDDEN_PATH}"
sudo cp -r dist "/var/www/html/${HIDDEN_PATH}"

sudo systemctl restart provider-ban-server
