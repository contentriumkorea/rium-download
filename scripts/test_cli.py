import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
import mcp_bridge
CLI = ROOT / 'skills/rium-download/scripts/rium_download.py'


class Tests(unittest.TestCase):
    def setUp(self):
        folder = ROOT / 'build/cli-tests'
        folder.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=folder)
        self.base = Path(self.tmp.name) / 'native'
        self.base.mkdir()
        self.batch = {'id':'batch', 'running':False, 'total':1, 'results':[{'status':'complete'}]}
        self.bridge = mcp_bridge.Bridge(self.base, 'chrome-extension://test/', self.reply)

    def reply(self, message):
        request = message['request']
        if request['method'] == 'tools/list':
            result = {'ok':True, 'tools':[{'name':'download_status'}]}
        else:
            result = {'ok':True, 'batch':self.batch, 'states':[]}
        self.bridge.reply({'id':message['id'], 'result':result})

    def tearDown(self):
        self.bridge.close()
        self.tmp.cleanup()

    def run_cli(self, *args):
        proc = subprocess.run([sys.executable, str(CLI), '--connection', str(self.bridge.path), *args],
                              capture_output=True, text=True, encoding='utf-8', timeout=15)
        return proc.returncode, json.loads(proc.stdout)

    def test_doctor_status_wait(self):
        code, result = self.run_cli('doctor')
        self.assertEqual(code, 0)
        self.assertEqual(result['tools'], ['download_status'])
        self.assertEqual(self.run_cli('status')[1]['batch']['id'], 'batch')
        self.assertTrue(self.run_cli('wait', '--batch', 'batch', '--timeout', '1')[1]['allDownloaded'])

    def test_wait_fails_for_partial_and_wrong_batch(self):
        self.batch['results'][0]['status'] = 'skipped'
        self.assertEqual(self.run_cli('wait', '--batch', 'batch', '--timeout', '1')[0], 1)
        self.batch['total'] = 0
        self.batch['results'] = []
        self.assertEqual(self.run_cli('wait', '--batch', 'batch', '--timeout', '1')[0], 1)
        self.assertEqual(self.run_cli('wait', '--batch', 'other', '--timeout', '1')[0], 1)

    def test_timeout_does_not_cancel(self):
        self.batch['running'] = True
        code, result = self.run_cli('wait', '--batch', 'batch', '--timeout', '1')
        self.assertEqual(code, 1)
        self.assertTrue(result['timedOut'])
        self.assertTrue(self.batch['running'])

    def test_player_commands_are_sent_to_bridge(self):
        messages = []
        def record(message):
            messages.append(message['request'])
            self.bridge.reply({'id':message['id'], 'result':{'ok':True, 'id':'job'}})
        self.bridge.send = record
        self.assertEqual(self.run_cli('youtube', '--tab', '4', '--mode', 'audio')[0], 0)
        self.assertEqual(messages[-1]['params'], {'name':'youtube_download', 'arguments':{'tabId':4, 'mode':'audio'}})
        self.assertEqual(self.run_cli('media', '--tab', '5', '--frame', '2')[0], 0)
        self.assertEqual(messages[-1]['params'], {'name':'media_download', 'arguments':{'tabId':5, 'frameId':2, 'mode':'video'}})
        self.assertEqual(self.run_cli('cancel-item', '--id', 'job')[0], 0)
        self.assertEqual(messages[-1]['params']['name'], 'queue_item_cancel')
        self.assertEqual(self.run_cli('open', 'https://example.com/watch')[0], 0)
        self.assertEqual(messages[-1]['params'], {'name':'open_url', 'arguments':{'url':'https://example.com/watch'}})
        self.assertEqual(self.run_cli('inspect', '--tab', '5', '--mode', 'audio')[0], 0)
        self.assertEqual(messages[-1]['params'], {'name':'media_inspect', 'arguments':{'tabId':5, 'frameId':0, 'mode':'audio'}})
        self.assertEqual(self.run_cli('select', '--inspection', 'scan', '--index', '1')[0], 0)
        self.assertEqual(messages[-1]['params'], {'name':'media_select', 'arguments':{'inspectionId':'scan', 'index':1}})
        self.assertEqual(self.run_cli('inspect', '--tab', '5', '--mode', 'photo')[0], 0)
        self.assertEqual(messages[-1]['params']['arguments']['mode'], 'photo')
        self.assertEqual(self.run_cli('download', '--collection', 'scan', '--mode', 'photo')[0], 0)
        self.assertEqual(messages[-1]['params']['arguments']['mode'], 'photo')


if __name__ == '__main__':
    unittest.main()
