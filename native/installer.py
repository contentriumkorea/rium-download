"""User-level installation; no tray, service, autostart or administrator access."""
import datetime
import html
import json
import os
from pathlib import Path
import shutil
import sys
import webbrowser

NAME = 'com.contentrium.rium_download'

def install(source, destination=None, register=True, open_guide=True):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    source = Path(source).resolve()
    manifest = json.loads((source / 'extension/manifest.json').read_text('utf-8-sig'))
    version = manifest['version']
    if destination is None:
        destination = (Path(os.environ['LOCALAPPDATA']) / 'Rium Download' if sys.platform == 'win32'
                       else Path.home() / 'Library/Application Support/Rium Download')
    destination = Path(destination).expanduser().absolute()
    if destination.is_symlink():
        raise RuntimeError('설치 폴더가 심볼릭 링크입니다. 다른 위치를 선택해 주세요.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f')
    release = destination / 'versions' / (version + '-' + stamp)
    release.mkdir(parents=True)
    shutil.copytree(source / 'native', release / 'native')
    extension = destination / 'extension'
    if extension.exists():
        shutil.copytree(extension, destination / 'backups' / stamp / 'extension')
    shutil.copytree(source / 'extension', extension, dirs_exist_ok=True)
    cfg = json.loads((release / 'native/config.json').read_text('utf-8-sig'))
    host = release / 'native' / ('rium-download-host.exe' if sys.platform == 'win32' else 'rium-download-host')
    if not host.is_file():
        raise RuntimeError('이 운영체제용 도우미 파일이 없습니다.')
    if sys.platform != 'win32':
        for item in (host, release / 'native' / cfg['node'], release / 'native' / cfg['ffmpeg']):
            item.chmod(item.stat().st_mode | 0o111)
    registration = {'name':NAME,'description':'Rium Download YouTube helper', 'path':str(host),
                    'type':'stdio','allowed_origins':cfg['allowed_origins']}
    local_manifest = release / 'native' / (NAME + '.json')
    local_manifest.write_text(json.dumps(registration, ensure_ascii=False, indent=2), 'utf-8')
    if register:
        if sys.platform == 'win32':
            import winreg
            for vendor in ('Google\\Chrome','Microsoft\\Edge','Chromium'):
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, 'Software\\'+vendor+'\\NativeMessagingHosts\\'+NAME) as key:
                    winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(local_manifest))
        elif sys.platform == 'darwin':
            for vendor in ('Google/Chrome','Microsoft Edge','Chromium','BraveSoftware/Brave-Browser'):
                directory = Path.home() / 'Library/Application Support' / vendor / 'NativeMessagingHosts'
                directory.mkdir(parents=True, exist_ok=True)
                (directory / (NAME + '.json')).write_text(json.dumps(registration, ensure_ascii=False, indent=2),'utf-8')
        else:
            raise RuntimeError('현재 설치기는 Windows와 macOS만 지원합니다.')
    guide = destination / '설치 안내.html'
    guide.write_text('''<!doctype html><meta charset="utf-8"><title>Rium Download 설치</title>
<style>body{font:17px system-ui;max-width:760px;margin:70px auto;padding:20px;color:#182331}h1{font-size:40px}code{display:block;background:#eff4ff;padding:20px;overflow-wrap:anywhere}li{margin:16px 0}</style>
<h1>Rium Download</h1><p>도우미 설치가 끝났습니다. 트레이나 자동 실행 프로그램은 추가하지 않습니다.</p>
<ol><li>Chrome 주소창에 <b>chrome://extensions</b>를 입력하세요. Edge는 edge://extensions입니다.</li>
<li>개발자 모드를 켜고 <b>압축해제된 확장 프로그램 로드</b>를 누르세요.</li>
<li>아래 폴더를 선택하세요.</li></ol><code>''' + html.escape(str(extension)) + '''</code>
<p>기존 설치를 업데이트했다면 확장 관리 페이지에서 Rium Download의 새로고침 버튼을 누르세요. 진행 중 다운로드가 끝난 뒤 업데이트하세요.</p>
<p>영상 사이트에서 확장 버튼을 눌러 해당 사이트를 켜면 영상·음원 버튼이 나타납니다.</p>''','utf-8')
    if open_guide:
        webbrowser.open(guide.as_uri())
    print('설치 완료: ' + str(extension))
    return {'extension':str(extension),'nativeManifest':str(local_manifest)}

def main():
    base=Path(sys.executable).resolve().parent if getattr(sys,'frozen',False) else Path(__file__).resolve().parent
    install(base.parent)

if __name__=='__main__':
    main()
