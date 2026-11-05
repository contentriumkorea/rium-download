"""Build native, offline installers from the already tested platform payload."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ARCH = os.environ.get('RIUM_ARCH', 'x64')
PACKAGE = ROOT / 'dist' / ('Rium-Download-' + sys.platform + '-' + ARCH)
VERSION = json.loads((PACKAGE / 'extension/manifest.json').read_text('utf-8-sig'))['version']

if sys.platform == 'win32':
    compiler = shutil.which('iscc') or r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
    subprocess.run([compiler, '/DPackageDir=' + str(PACKAGE), '/DAppVersion=' + VERSION,
                    str(ROOT / 'install/windows.iss')], check=True)
elif sys.platform == 'darwin':
    stage = ROOT / 'build/dmg'
    app = stage / 'Rium Download 설치.app'
    contents = app / 'Contents'
    (contents / 'MacOS').mkdir(parents=True, exist_ok=True)
    resources = contents / 'Resources'
    resources.mkdir(exist_ok=True)
    shutil.copytree(PACKAGE, resources / 'payload', dirs_exist_ok=True)
    subprocess.run(['swiftc', '-O', '-framework', 'Cocoa', str(ROOT / 'install/MacSetup.swift'),
                    '-o', str(contents / 'MacOS/RiumSetup')], check=True)
    (contents / 'Info.plist').write_bytes(plistlib.dumps({
        'CFBundleExecutable': 'RiumSetup', 'CFBundleIdentifier': 'com.contentrium.rium-download.setup',
        'CFBundleName': 'Rium Download 설치', 'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': VERSION, 'CFBundleVersion': VERSION,
        'NSHighResolutionCapable': True,
    }))
    # Local integrity signature only; not an Apple Developer signature/notarization.
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
    output = ROOT / 'dist' / ('Rium-Download-Setup-macOS-' + ('AppleSilicon' if ARCH == 'arm64' else 'Intel') + '.dmg')
    subprocess.run(['hdiutil', 'create', '-volname', 'Rium Download', '-srcfolder', str(stage),
                    '-format', 'UDZO', '-ov', str(output)], check=True)
else:
    raise RuntimeError('Unsupported OS')
