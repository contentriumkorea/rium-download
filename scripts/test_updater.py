from pathlib import Path
import importlib.util,json,sys,tempfile,zipfile
from unittest.mock import patch
root=Path(__file__).resolve().parents[1];(root/'build').mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('updater',root/'native/updater.py');u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
with tempfile.TemporaryDirectory(dir=root/'build') as tmp:
 t=Path(tmp); installed=t/'installed';(installed/'extension').mkdir(parents=True)
 manifest=json.loads((root/'extension/manifest.json').read_text('utf-8-sig'));manifest['version']='2.8.3';origin='chrome-extension://'+u.identifier(manifest)+'/'
 (installed/'extension/manifest.json').write_text(json.dumps(manifest));(installed/'extension/preserved-old.js').write_text('old')
 reg=t/'browser-manifest.json';old_reg={'allowed_origins':[origin],'path':'original'};reg.write_text(json.dumps(old_reg))
 def package(name):
  p=t/name;(p/'extension').mkdir(parents=True);(p/'native/tools').mkdir(parents=True)
  m=dict(manifest,version='2.8.4');(p/'extension/manifest.json').write_text(json.dumps(m));(p/'extension/new.js').write_text('new')
  for f in ('node','ffmpeg'):(p/'native/tools'/f).write_text('fixture')
  host='rium-download-host.exe' if sys.platform=='win32' else 'rium-download-host';(p/'native'/host).write_text('fixture')
  (p/'native/config.json').write_text(json.dumps({'allowed_origins':[origin],'node':'tools/node','ffmpeg':'tools/ffmpeg'}));return p
 p=package('fail')
 with patch.object(u,'manifests',return_value=[reg]),patch.object(u.os,'replace',side_effect=PermissionError('fixture')):
  try:u.apply_package(installed,p,origin,'2.8.4');raise AssertionError('expected failure')
  except PermissionError:pass
 assert (installed/'extension/preserved-old.js').read_text()=='old'
 assert json.loads(reg.read_text())==old_reg
 p=package('success')
 with patch.object(u,'manifests',return_value=[reg]):assert u.apply_package(installed,p,origin,'2.8.4')=='2.8.4'
 assert (installed/'extension/new.js').read_text()=='new'
 assert Path(json.loads(reg.read_text())['path']).is_file()
 assert list((installed/'backups').rglob('preserved-old.js'))
 malicious=t/'bad.zip'
 with zipfile.ZipFile(malicious,'w') as z:z.writestr('package/../../escape','bad')
 try:u.extract(malicious,t/'unpacked');raise AssertionError('path traversal accepted')
 except ValueError:pass
 lock=installed/'update.lock';lock.write_text('fixture')
 with patch.object(u,'install_root',return_value=installed),patch.object(u,'release_asset',side_effect=AssertionError('network should not run')):
  try:u.update(t/'native',origin);raise AssertionError('concurrent update accepted')
  except ValueError:pass
 assert lock.read_text()=='fixture'
 print('Updater transaction, rollback, lock, native registration and traversal rejection PASS')
