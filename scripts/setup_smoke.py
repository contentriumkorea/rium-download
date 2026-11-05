"""Installer lifecycle tests, restricted to disposable GitHub-hosted runners."""
import json
import os
from pathlib import Path
import subprocess
import sys

if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
    raise SystemExit('Run installation/registry tests only on a disposable GitHub-hosted runner.')
ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / 'build/setup-smoke'
TEST.mkdir(parents=True, exist_ok=True)
NAME = 'com.contentrium.rium_download'

if sys.platform == 'win32':
    import winreg
    target = TEST / 'installed'
    setup = ROOT / 'dist/Rium-Download-Setup-Windows-x64.exe'
    subprocess.run([str(setup), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART',
                    '/DIR=' + str(target), '/LOG=' + str(TEST / 'install.log')], check=True, timeout=180)
    manifest = target / 'native' / (NAME + '.json')
    registration = json.loads(manifest.read_text('utf-8'))
    assert Path(registration['path']).is_file()
    for vendor in ('Google\\Chrome', 'Microsoft\\Edge', 'Chromium'):
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Software\\' + vendor + '\\NativeMessagingHosts\\' + NAME) as key:
            assert Path(winreg.QueryValueEx(key, '')[0]) == manifest
    user_file = target / 'keep-user-video.m4a'
    user_file.write_bytes(b'user-owned fixture')
    subprocess.run([str(target / 'unins000.exe'), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], check=True, timeout=120)
    assert user_file.read_bytes() == b'user-owned fixture'
    assert not (target / 'native/rium-download-host.exe').exists()
    for vendor in ('Google\\Chrome', 'Microsoft\\Edge', 'Chromium'):
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Software\\' + vendor + '\\NativeMessagingHosts\\' + NAME)
        except FileNotFoundError:
            pass
        else:
            key.Close()
            raise AssertionError('Registration remained after uninstall')
    print('Windows EXE install, registrations, uninstall and user-file preservation PASS')
elif sys.platform == 'darwin':
    import plistlib
    arch = os.environ.get('RIUM_ARCH', 'x64')
    dmg = ROOT / 'dist' / ('Rium-Download-Setup-macOS-' + ('AppleSilicon' if arch == 'arm64' else 'Intel') + '.dmg')
    mount = TEST / 'mounted'
    mount.mkdir(exist_ok=True)
    subprocess.run(['hdiutil', 'verify', str(dmg)], check=True)
    subprocess.run(['hdiutil', 'attach', '-nobrowse', '-mountpoint', str(mount), str(dmg)], check=True)
    try:
        app = mount / 'Rium Download 설치.app'
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        assert (app / 'Contents/MacOS' / info['CFBundleExecutable']).is_file()
        fake_home = TEST / 'home'
        fake_home.mkdir(exist_ok=True)
        env = dict(os.environ, HOME=str(fake_home))
        host = app / 'Contents/Resources/payload/native/rium-download-host'
        subprocess.run([str(host), '--install', '--no-guide'], env=env, check=True, timeout=180)
        target = fake_home / 'Library/Application Support/Rium Download'
        assert (target / 'extension/manifest.json').is_file()
        for vendor in ('Google/Chrome', 'Microsoft Edge'):
            path = fake_home / 'Library/Application Support' / vendor / 'NativeMessagingHosts' / (NAME + '.json')
            cfg = json.loads(path.read_text('utf-8'))
            assert Path(cfg['path']).is_file()
        print('Mac DMG integrity, app signature, packaged installation and registrations PASS (GUI untested)')
    finally:
        subprocess.run(['hdiutil', 'detach', str(mount)], check=True)
