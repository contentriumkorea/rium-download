# Third-party notices

Rium Download does not replace the licenses of its bundled components.

- mux.js: Apache License 2.0; extension/MUX-LICENSE.txt. https://github.com/videojs/mux.js
- yt-dlp and yt-dlp-ejs: their upstream licenses, included under licenses/ in the installers. https://github.com/yt-dlp/yt-dlp
- Node.js: MIT and included third-party licenses; licenses/node-license.txt in the installers. https://nodejs.org/
- Python and PyInstaller runtime: PSF license and PyInstaller license/bootloader exception. https://www.python.org/psf/license/ ; https://pyinstaller.org/en/stable/license.html
- imageio-ffmpeg: BSD-2-Clause wrapper; bundled FFmpeg has its own license and build configuration, recorded in licenses/ffmpeg-build.txt. https://github.com/imageio/imageio-ffmpeg
- FFmpeg: LGPL/GPL depending on the bundled build. FFmpeg copyright and applicable terms remain in force. Upstream source: https://ffmpeg.org/download.html ; build recipes and binary provenance: https://github.com/imageio/imageio-binaries

The build scripts retain tool licenses and record FFmpeg build details. The host
only remuxes streams; it does not re-encode or remove DRM. Download only material
you are entitled to save.
