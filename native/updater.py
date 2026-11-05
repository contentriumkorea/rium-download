"""Verified GitHub updates for the user's standard packaged installation."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import sys
import urllib.request
import uuid
import zipfile
from urllib.parse import urlsplit

REPO = 'contentriumkorea/rium-download'
NAME = 'com.contentrium.rium_download'
HEADERS = {'User-Agent': 'Rium-Download-Updater', 'Accept': 'application/vnd.github+json'}
DOWNLOAD_HOSTS = ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com')
MAX_DOWNLOAD = 300 * 1024 * 1024
MAX_EXPANDED = 700 * 1024 * 1024


def install_root(base):
    base = Path(base).resolve()
    # Standard releases keep the native host either in <root>/native or
    # <root>/versions/<version>/native. Never accept a caller supplied path.
    if base.name != 'native':
        raise ValueError('지원하지 않는 도우미 설치 위치입니다.')
    parent = base.parent
    root = parent.parent.parent if parent.parent.name == 'versions' else parent
    expected = (Path(os.environ['LOCALAPPDATA']) / 'Rium Download' if sys.platform == 'win32'
                else Path.home() / 'Library/Application Support/Rium Download')
    if root.resolve() != expected.resolve() or root.is_symlink() or (root/'extension').is_symlink():
        raise ValueError('표준 설치 위치가 아닙니다. 설치파일로 한 번 설치해 주세요.')
    if any((root/name).is_symlink() for name in ('versions', 'backups', 'updates')):
        raise ValueError('설치 폴더에 심볼릭 링크가 있어 업데이트할 수 없습니다.')
    return root


def identifier(manifest):
    key = base64.b64decode(manifest['key'], validate=True)
    return ''.join(chr(97 + int(c, 16)) for c in hashlib.sha256(key).hexdigest()[:32])


def release_asset():
    if sys.platform == 'win32' and platform.machine().lower() in ('amd64', 'x86_64'):
        name = 'Rium-Download-Windows-x64.zip'
    elif sys.platform == 'darwin' and platform.machine().lower() in ('arm64', 'aarch64'):
        name = 'Rium-Download-macOS-AppleSilicon.zip'
    elif sys.platform == 'darwin' and platform.machine().lower() in ('x86_64', 'amd64'):
        name = 'Rium-Download-macOS-Intel.zip'
    else:
        raise ValueError('지원하지 않는 운영체제 또는 CPU입니다.')
    req = urllib.request.Request('https://api.github.com/repos/' + REPO + '/releases/latest', headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as response:
        release = json.load(response)
    tag = release.get('tag_name', '')
    if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'v\d+\.\d+\.\d+(?:\.\d+)?', tag):
        raise ValueError('최신 정식 버전 정보를 확인하지 못했습니다.')
    assets = [a for a in release.get('assets', []) if a.get('name') == name]
    if len(assets) != 1:
        raise ValueError('이 컴퓨터용 설치 패키지가 없습니다.')
    a = assets[0]
    expected_url = 'https://github.com/' + REPO + '/releases/download/' + tag + '/' + name
    if a.get('browser_download_url') != expected_url or not re.fullmatch(r'sha256:[a-f0-9]{64}', a.get('digest', '')):
        raise ValueError('업데이트 출처 또는 무결성 정보가 올바르지 않습니다.')
    if not isinstance(a.get('size'), int) or not 0 < a['size'] <= MAX_DOWNLOAD:
        raise ValueError('업데이트 파일 크기가 올바르지 않습니다.')
    return tag[1:], a


def download(asset, path):
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            u = urlsplit(newurl)
            if u.scheme != 'https' or u.hostname not in DOWNLOAD_HOSTS:
                raise ValueError('업데이트 다운로드 출처가 올바르지 않습니다.')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    req = urllib.request.Request(asset['browser_download_url'], headers=HEADERS)
    digest = hashlib.sha256()
    size = 0
    with urllib.request.build_opener(SafeRedirect()).open(req, timeout=60) as response:
        endpoint = urlsplit(response.geturl())
        if endpoint.scheme != 'https' or endpoint.hostname not in DOWNLOAD_HOSTS:
            raise ValueError('업데이트 다운로드 출처가 올바르지 않습니다.')
        with path.open('xb') as stream:
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > asset['size'] or size > MAX_DOWNLOAD:
                    raise ValueError('업데이트 파일 크기가 일치하지 않습니다.')
                stream.write(block)
                digest.update(block)
    if size != asset['size'] or 'sha256:' + digest.hexdigest() != asset['digest']:
        raise ValueError('업데이트 파일 검증에 실패했습니다.')


def extract(archive, destination):
    with zipfile.ZipFile(archive) as z:
        names = set()
        total = 0
        roots = set()
        for item in z.infolist():
            name = item.filename
            p = PurePosixPath(name)
            if not name or '\\' in name or p.is_absolute() or any(x in ('.', '..') for x in p.parts) or ':' in name:
                raise ValueError('잘못된 압축 경로입니다.')
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('심볼릭 링크를 포함한 패키지는 지원하지 않습니다.')
            canonical = name.rstrip('/').casefold()
            if canonical in names:
                raise ValueError('중복된 압축 경로입니다.')
            names.add(canonical)
            roots.add(p.parts[0])
            total += item.file_size
            if len(names) > 30000 or total > MAX_EXPANDED:
                raise ValueError('업데이트 패키지가 너무 큽니다.')
        if len(roots) != 1:
            raise ValueError('패키지 구조가 올바르지 않습니다.')
        z.extractall(destination)
    return destination / roots.pop()


def manifests(root):
    if sys.platform == 'win32':
        import winreg
        out = []
        for vendor in ('Google\\Chrome', 'Microsoft\\Edge', 'Chromium'):
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Software\\'+vendor+'\\NativeMessagingHosts\\'+NAME) as key:
                    p = Path(winreg.QueryValueEx(key, '')[0]).resolve(strict=True)
                if not p.is_relative_to(root.resolve()) or p.name != NAME+'.json':
                    raise ValueError('다른 설치가 브라우저 도우미를 사용하고 있습니다.')
                if p not in out:
                    out.append(p)
            except FileNotFoundError:
                continue
        return out
    out = [p for v in ('Google/Chrome','Microsoft Edge','Chromium','BraveSoftware/Brave-Browser')
           if (p := Path.home()/'Library/Application Support'/v/'NativeMessagingHosts'/(NAME+'.json')).is_file()]
    if any(p.is_symlink() for p in out):
        raise ValueError('도우미 등록에 심볼릭 링크가 있습니다.')
    return out


def apply_package(root, package, expected_origin, version):
    root = Path(root).resolve()
    old = root/'extension'
    old_manifest = json.loads((old/'manifest.json').read_text('utf-8-sig'))
    new_manifest = json.loads((package/'extension/manifest.json').read_text('utf-8-sig'))
    if (new_manifest.get('version') != version or 'chrome-extension://'+identifier(new_manifest)+'/' != expected_origin
            or identifier(old_manifest) != identifier(new_manifest)):
        raise ValueError('확장 ID 또는 버전이 설치본과 일치하지 않습니다.')
    def parse(v): return tuple(int(x) for x in v.split('.'))
    if parse(version) <= parse(old_manifest['version']):
        raise ValueError('설치된 확장보다 새로운 버전이 아닙니다.')
    cfg = json.loads((package/'native/config.json').read_text('utf-8-sig'))
    if expected_origin not in cfg.get('allowed_origins', []):
        raise ValueError('도우미 연결 정보가 올바르지 않습니다.')
    for name in ('node', 'ffmpeg'):
        item = (package/'native'/cfg[name]).resolve()
        if not item.is_relative_to((package/'native').resolve()) or not item.is_file():
            raise ValueError('도우미 구성요소 경로가 올바르지 않습니다.')
    paths = manifests(root)
    if not paths:
        raise ValueError('브라우저 도우미 등록을 찾을 수 없습니다.')
    original = {p: p.read_bytes() for p in paths}
    if any(expected_origin not in json.loads(data.decode('utf-8-sig')).get('allowed_origins', []) for data in original.values()):
        raise ValueError('다른 확장 프로그램이 이 도우미를 사용하고 있습니다.')
    stamp = version + '-' + uuid.uuid4().hex
    release = root/'versions'/stamp
    release.mkdir(parents=True)
    shutil.copytree(package/'native', release/'native')
    if (package/'licenses').is_dir():
        shutil.copytree(package/'licenses', release/'licenses')
    for name in ('LICENSE', 'THIRD-PARTY.md'):
        if (package/name).is_file():
            shutil.copy2(package/name, release/name)
    host = release/'native'/('rium-download-host.exe' if sys.platform=='win32' else 'rium-download-host')
    if not host.is_file():
        raise ValueError('새 도우미 파일이 없습니다.')
    if sys.platform != 'win32':
        for item in (host, release/'native'/cfg['node'], release/'native'/cfg['ffmpeg']):
            item.chmod(item.stat().st_mode | 0o111)
    registration = {'name':NAME,'description':'Rium Download YouTube helper','path':str(host),'type':'stdio','allowed_origins':cfg['allowed_origins']}
    content = json.dumps(registration, ensure_ascii=False, indent=2).encode('utf-8')
    backup = root/'backups'/stamp
    backup.mkdir(parents=True)
    old.rename(backup/'extension')
    swapped = False
    try:
        (package/'extension').rename(old)
        swapped = True
        for path in paths:
            temp = path.with_name(path.name+'.rium-new-'+uuid.uuid4().hex)
            temp.write_bytes(content)
            os.replace(temp, path)
    except Exception:
        for path, data in original.items():
            path.write_bytes(data)
        if swapped:
            old.rename(backup/'failed-new-extension')
        (backup/'extension').rename(old)
        raise
    return version


def update(base, origin):
    root = install_root(base)
    version, asset = release_asset()
    stage = root/'updates'/uuid.uuid4().hex
    stage.mkdir(parents=True)
    archive = stage/'package.zip'
    download(asset, archive)
    package = extract(archive, stage/'package')
    return apply_package(root, package, origin, version)
