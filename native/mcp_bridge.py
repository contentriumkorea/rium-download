"""Opt-in, authenticated loopback bridge. MCP itself uses newline-delimited stdio."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import sys
import threading
import urllib.request
import uuid


def descriptor(base, origin):
    root = base.parent.parent.parent if base.parent.parent.name == 'versions' else base.parent
    return root / 'tmp' / 'mcp' / (hashlib.sha256(origin.encode()).hexdigest()[:16] + '.json')


class Bridge:
    def __init__(self, base, origin, send):
        self.send = send
        self.pending = {}
        self.lock = threading.Lock()
        self.token = secrets.token_urlsafe(32)
        self.path = descriptor(base, origin)
        bridge = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.connection.settimeout(10)
                if (self.path != '/rpc' or self.headers.get('Origin') is not None
                        or self.headers.get('Host') != '127.0.0.1:' + str(bridge.server.server_port)
                        or not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + bridge.token)):
                    self.send_error(403)
                    return
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 16000:
                        raise ValueError()
                    request = json.loads(self.rfile.read(size))
                    if not isinstance(request, dict):
                        raise ValueError()
                    with bridge.lock:
                        if len(bridge.pending) >= 4:
                            raise ValueError()
                        ident = str(uuid.uuid4())
                        event = threading.Event()
                        slot = {'event': event}
                        bridge.pending[ident] = slot
                    try:
                        bridge.send({'type': 'mcpRequest', 'id': ident, 'request': request})
                        if not event.wait(90):
                            result = {'ok': False, 'error': '브라우저 응답 시간이 초과되었습니다. 일괄 상태를 확인한 뒤 재시도하세요.'}
                        else:
                            result = slot['result']
                    finally:
                        with bridge.lock:
                            bridge.pending.pop(ident, None)
                    data = json.dumps(result, ensure_ascii=False).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (ValueError, TypeError):
                    self.send_error(400)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # The OS releases this lock after crashes. Never redirect another running profile.
        self.lease = open(self.path.with_suffix('.lock'), 'a+b')
        if self.lease.tell() == 0:
            self.lease.write(b'0'); self.lease.flush()
        self.lease.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lease.close(); self.server.server_close()
            raise ValueError('다른 브라우저에서 MCP가 연결되어 있습니다. 그 연결을 끈 뒤 시도하세요.')
        temporary = self.path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump({'port': self.server.server_port, 'token': self.token}, stream)
            os.replace(temporary, self.path)
        except Exception:
            temporary.unlink(missing_ok=True)
            self.lease.close(); self.server.server_close()
            raise
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def reply(self, msg):
        with self.lock:
            slot = self.pending.get(msg.get('id'))
            if slot:
                slot['result'] = msg.get('result', {'ok': False})
                slot['event'].set()

    def close(self):
        with self.lock:
            for slot in self.pending.values():
                slot['result'] = {'ok': False, 'error': 'MCP 연결이 종료되었습니다.'}
                slot['event'].set()
        self.server.shutdown()
        self.server.server_close()
        try:
            if json.loads(self.path.read_text('utf-8')).get('token') == self.token:
                self.path.unlink()
        except (OSError, ValueError):
            pass
        self.lease.close()


def call(path, request):
    try:
        settings = json.loads(Path(path).read_text('utf-8'))
        port, token = settings['port'], settings['token']
        if type(port) is not int or not 1 <= port <= 65535 or not isinstance(token, str) or len(token) < 32:
            raise ValueError()
        data = json.dumps(request).encode('utf-8')
        req = urllib.request.Request(f'http://127.0.0.1:{port}/rpc', data=data,
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        # Never forward credentials through a configured system proxy.
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=95) as response:
            return json.loads(response.read(2_000_000))
    except Exception:
        return {'ok': False, 'error': '확장 팝업에서 MCP 연결을 켜고 연결 설정을 다시 확인해 주세요.'}


def stdio(path):
    while True:
        raw = sys.stdin.buffer.readline(16386)
        if not raw:
            break
        if len(raw) > 16384:
            return
        ident = None
        try:
            if len(raw) > 16384:
                raise ValueError()
            msg = json.loads(raw)
            if not isinstance(msg, dict) or msg.get('jsonrpc') != '2.0':
                raise ValueError()
            if 'id' not in msg:
                continue
            ident = msg['id']
            method = msg.get('method')
            if method == 'initialize':
                supported = ('2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25')
                version = (msg.get('params') or {}).get('protocolVersion')
                result = {'protocolVersion': version if version in supported else supported[-1],
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'rium-download', 'version': '2.9.0-dev'}}
            elif method == 'ping':
                result = {}
            elif method in ('tools/list', 'tools/call'):
                reply = call(path, {'method': method, 'params': msg.get('params', {})})
                if method == 'tools/list':
                    if not reply.get('ok'):
                        raise RuntimeError(reply.get('error'))
                    result = {'tools': reply['tools']}
                else:
                    result = {'content': [{'type': 'text', 'text': json.dumps(reply, ensure_ascii=False)}],
                              'isError': not reply.get('ok', False)}
            else:
                print(json.dumps({'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32601, 'message': 'Method not found'}}), flush=True)
                continue
            response = {'jsonrpc': '2.0', 'id': ident, 'result': result}
        except Exception as error:
            response = {'jsonrpc': '2.0', 'id': ident, 'error': {'code': -32603 if isinstance(error, RuntimeError) else -32600,
                        'message': str(error) if isinstance(error, RuntimeError) else 'Invalid request'}}
        sys.stdout.buffer.write((json.dumps(response, ensure_ascii=False) + '\n').encode('utf-8'))
        sys.stdout.buffer.flush()
