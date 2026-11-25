"""Real loopback/stdin transport tests; no user browser or Instagram traffic."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
import mcp_bridge


class Tests(unittest.TestCase):
    def setUp(self):
        output = ROOT / 'build' / 'mcp-tests'
        output.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=output)
        self.base = Path(self.temp.name) / 'native'
        self.base.mkdir()
        self.origin = 'chrome-extension://test/'
        self.bridge = mcp_bridge.Bridge(self.base, self.origin, self.reply)

    def reply(self, message):
        request = message['request']
        result = {'ok': True, 'tools': []} if request['method'] == 'tools/list' else {'ok': True, 'echo': request['params']}
        self.bridge.reply({'id': message['id'], 'result': result})

    def tearDown(self):
        self.bridge.close()
        self.temp.cleanup()

    def test_roundtrip(self):
        self.assertEqual(mcp_bridge.call(self.bridge.path, {'method': 'tools/list'}), {'ok': True, 'tools': []})

    def test_cli(self):
        result = subprocess.run([sys.executable, str(ROOT/'native/host.py'), '--mcp-call', str(self.bridge.path),
                                 'download_status', '{}'], capture_output=True, text=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['echo']['name'], 'download_status')

    def test_stdio(self):
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'test', 'arguments': {}}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'unknown'}]
        proc = subprocess.run([sys.executable, str(ROOT/'native/host.py'), '--mcp', str(self.bridge.path)],
                              input='\n'.join(json.dumps(x) for x in messages)+'\n', capture_output=True, text=True,
                              encoding='utf-8', timeout=15)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        results = [json.loads(x) for x in proc.stdout.splitlines()]
        self.assertEqual(len(results), 4)
        self.assertEqual(results[0]['result']['protocolVersion'], '2025-11-25')
        self.assertEqual(results[1]['result']['tools'], [])
        self.assertFalse(results[2]['result']['isError'])
        self.assertEqual(results[3]['error']['code'], -32601)

    def test_websites_and_unauthenticated_clients_rejected(self):
        settings = json.loads(self.bridge.path.read_text())
        for headers in ({}, {'Authorization': 'Bearer '+settings['token'], 'Origin': 'https://www.instagram.com'},
                        {'Authorization': 'Bearer '+settings['token'], 'Host': 'attacker.example'}):
            req = urllib.request.Request(f"http://127.0.0.1:{settings['port']}/rpc", data=b'{}', headers=headers)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req)
            self.assertEqual(error.exception.code, 403)

    def test_second_browser_cannot_hijack_connection(self):
        with self.assertRaises(ValueError):
            mcp_bridge.Bridge(self.base, self.origin, self.reply)
        self.assertTrue(mcp_bridge.call(self.bridge.path, {'method': 'tools/list'})['ok'])

    def test_stale_descriptor_replaced_after_close(self):
        self.bridge.close()
        self.bridge.path.write_text('{"port":1,"token":"stale"}')
        self.bridge = mcp_bridge.Bridge(self.base, self.origin, self.reply)
        self.assertTrue(mcp_bridge.call(self.bridge.path, {'method': 'tools/list'})['ok'])


if __name__ == '__main__':
    unittest.main()
