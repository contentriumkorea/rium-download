"""Portable Rium Download CLI. Python stdlib only; uses the browser's existing queue."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.request


class CliError(Exception):
    pass


def connection(explicit=None):
    if explicit:
        candidates = [Path(explicit).expanduser()]
    elif os.environ.get('RIUM_CONNECTION_FILE'):
        candidates = [Path(os.environ['RIUM_CONNECTION_FILE']).expanduser()]
    else:
        roots = [Path.home() / 'Library/Application Support/Rium Download/tmp/mcp']
        if os.environ.get('LOCALAPPDATA'):
            roots.append(Path(os.environ['LOCALAPPDATA']) / 'Rium Download/tmp/mcp')
        settings = Path(__file__).resolve().parent.parent / 'local-settings.json'
        if settings.exists():
            try:
                roots += [Path(p) for p in json.loads(settings.read_text('utf-8'))['connectionDirectories']]
            except (KeyError, ValueError, TypeError):
                raise CliError('로컬 연결 설정이 올바르지 않습니다.')
        candidates = sorted({p.resolve() for root in roots for p in root.glob('*.json') if p.is_file()})
    if len(candidates) != 1:
        if not candidates:
            raise CliError('연결 없음: Rium Download 확장 팝업에서 MCP 연결을 켜 주세요. 개발 설치는 --connection 또는 로컬 연결 설정이 필요합니다.')
        raise CliError('연결이 여러 개입니다. --connection으로 사용할 연결 파일을 지정하세요.')
    try:
        value = json.loads(candidates[0].read_text('utf-8'))
        port, token = value['port'], value['token']
        if type(port) is not int or not 1 <= port <= 65535 or not isinstance(token, str) or not 32 <= len(token) <= 256:
            raise ValueError()
        return port, token
    except (OSError, KeyError, ValueError, TypeError):
        raise CliError('연결 파일을 읽지 못했습니다. 확장 팝업에서 MCP 연결을 다시 켜 주세요.')


def rpc(selected, method, params=None):
    port, token = connection(selected)
    request = urllib.request.Request(f'http://127.0.0.1:{port}/rpc',
        data=json.dumps({'method': method, 'params': params or {}}).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=95) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError()
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise ValueError()
            return result
    except Exception:
        # Never print urllib exception objects: they may contain private connection details.
        raise CliError('브라우저 연결 요청 실패: MCP 연결 상태를 확인하세요. 다운로드 시작 요청이었다면 status로 접수 여부를 먼저 확인하세요.')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Rium Download: existing browser queue CLI (JSON output)')
    parser.add_argument('--connection', help='Explicit runtime connection JSON file (never paste its token)')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('doctor', 'tools', 'tabs', 'youtube-tabs', 'media-tabs', 'status', 'cancel'):
        sub.add_parser(name)
    media = sub.add_parser('media', help='Queue a selected website player')
    media.add_argument('--tab', type=int, required=True)
    media.add_argument('--frame', type=int, default=0)
    media.add_argument('--mode', choices=('video', 'audio', 'photo'), default='video')
    opened = sub.add_parser('open', help='Open a page in an inactive browser tab')
    opened.add_argument('url')
    inspect = sub.add_parser('inspect', help='Inspect available formats on an open tab')
    inspect.add_argument('--tab', type=int, required=True)
    inspect.add_argument('--frame', type=int, default=0)
    inspect.add_argument('--mode', choices=('video', 'audio', 'photo'), default='video')
    select = sub.add_parser('select', help='Queue a format from a recent inspection')
    select.add_argument('--inspection', required=True)
    select.add_argument('--index', type=int, required=True)
    saving = sub.add_parser('save-mode', help='Read or set browser save mode')
    saving.add_argument('mode', nargs='?', choices=('default', 'ask'))
    for item_command in ('remove-item', 'show-item'):
        command = sub.add_parser(item_command)
        command.add_argument('--id', required=True)
    youtube = sub.add_parser('youtube', help='Queue an open YouTube player')
    youtube.add_argument('--tab', type=int, required=True)
    youtube.add_argument('--mode', choices=('video', 'audio'), default='video')
    item_cancel = sub.add_parser('cancel-item', help='Cancel one queue item')
    item_cancel.add_argument('--id', required=True)
    item_wait = sub.add_parser('wait-item', help='Wait for a queue item; timeout does not cancel')
    item_wait.add_argument('--id', required=True)
    item_wait.add_argument('--timeout', type=int, default=300)
    collect = sub.add_parser('collect', help='Scroll a selected Instagram profile and collect post/reel links')
    collect.add_argument('--tab', type=int, required=True)
    collect.add_argument('--username', required=True)
    collect.add_argument('--limit', type=int, default=100, choices=range(1, 101), metavar='1..100')
    download = sub.add_parser('download', help='Start a previously reviewed collection; does not wait')
    download.add_argument('--collection', required=True)
    download.add_argument('--mode', choices=('video', 'audio', 'photo'), default='video')
    wait = sub.add_parser('wait', help='Wait for a specific batch; timeout never cancels downloads')
    wait.add_argument('--batch', required=True)
    wait.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args(argv)
    def call(name, arguments=None):
        return rpc(args.connection, 'tools/call', {'name': name, 'arguments': arguments or {}})
    try:
        if args.command in ('doctor', 'tools'):
            result = rpc(args.connection, 'tools/list')
            if args.command == 'doctor' and result.get('ok'):
                result = {'ok': True, 'connected': True, 'tools': [t['name'] for t in result['tools']]}
        elif args.command == 'collect':
            result = call('instagram_collect', {'tabId': args.tab, 'username': args.username, 'limit': args.limit})
        elif args.command == 'download':
            result = call('instagram_download', {'collectionId': args.collection, 'mode': args.mode})
        elif args.command == 'youtube':
            result = call('youtube_download', {'tabId': args.tab, 'mode': args.mode})
        elif args.command == 'media':
            result = call('media_download', {'tabId':args.tab, 'frameId':args.frame, 'mode':args.mode})
        elif args.command == 'open':
            result = call('open_url', {'url':args.url})
        elif args.command == 'inspect':
            result = call('media_inspect', {'tabId':args.tab, 'frameId':args.frame, 'mode':args.mode})
        elif args.command == 'select':
            result = call('media_select', {'inspectionId':args.inspection, 'index':args.index})
        elif args.command == 'save-mode':
            result = call('save_mode', {'mode':args.mode} if args.mode else {})
        elif args.command in ('remove-item', 'show-item'):
            result = call('queue_item_remove' if args.command == 'remove-item' else 'queue_item_show', {'id':args.id})
        elif args.command == 'cancel-item':
            result = call('queue_item_cancel', {'id': args.id})
        elif args.command in ('wait', 'wait-item'):
            if not 1 <= args.timeout <= 86400:
                raise CliError('timeout은 1~86400초입니다.')
            end = time.monotonic() + args.timeout
            while True:
                result = call('download_status')
                if not result.get('ok'):
                    break
                if args.command == 'wait-item':
                    row = next((row for row in result.get('states', []) if row.get('id') == args.id), None)
                    if not row:
                        raise CliError('다운로드 항목을 찾을 수 없습니다. 확장 재시작이나 목록 제거 여부를 확인하세요.')
                    if row.get('phase') in ('complete', 'error', 'cancelled'):
                        result = {'ok':row['phase']=='complete', 'item':row}
                        break
                    if time.monotonic() >= end:
                        result = {'ok':False, 'timedOut':True, 'item':row, 'error':'대기 시간 종료. 다운로드는 계속됩니다.'}
                        break
                    time.sleep(min(2, max(0, end-time.monotonic())))
                    continue
                batch = result.get('batch')
                if not batch or batch.get('id') != args.batch:
                    raise CliError('요청한 일괄 작업을 찾을 수 없습니다. 확장 재시작 또는 다른 작업 시작 여부를 확인하세요.')
                if not batch.get('running'):
                    rows = batch.get('results', [])
                    result['allDownloaded'] = (bool(batch.get('total')) and not batch.get('error') and not batch.get('cancelled')
                        and len(rows) == batch.get('total') and all(row.get('status') == 'complete' for row in rows))
                    result['ok'] = result['allDownloaded']
                    break
                if time.monotonic() >= end:
                    result = {'ok': False, 'timedOut': True, 'batchId': args.batch,
                              'error': '대기 시간 종료. 다운로드는 계속됩니다. status 또는 wait로 다시 확인하세요.'}
                    break
                time.sleep(min(2, max(0, end-time.monotonic())))
        else:
            result = call({'tabs': 'instagram_tabs', 'youtube-tabs':'youtube_tabs', 'media-tabs':'media_tabs', 'status': 'download_status', 'cancel': 'download_cancel'}[args.command])
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get('ok') else 1
    except CliError as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
