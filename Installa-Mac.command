#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Serve Python 3.9 o successivo da python.org. Non verrà installato automaticamente."
  read -r -p "Premi Invio per chiudere. " reply
  exit 1
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else "Serve Python 3.9 o successivo")'
python3 install_macos.py
read -r -p "Premi Invio per chiudere. " reply
