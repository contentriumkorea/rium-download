#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
chmod +x native/rium-download-host native/tools/node native/tools/ffmpeg
./native/rium-download-host --install
