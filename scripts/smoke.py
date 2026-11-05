import json,struct,subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
pkg=next(p for p in (root/'dist').iterdir() if p.is_dir())
cfg=json.loads((pkg/'native/config.json').read_text())
exe=pkg/'native'/('rium-download-host.exe' if sys.platform=='win32' else 'rium-download-host')
proc=subprocess.Popen([str(exe),cfg['allowed_origins'][0]],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
b=json.dumps({'type':'ping'}).encode()
out,_=proc.communicate(struct.pack('<I',len(b))+b,timeout=30)
assert proc.returncode==0 and len(out)>=4
n=struct.unpack('<I',out[:4])[0];assert json.loads(out[4:4+n])=={'type':'pong','version':1}
for tool in ('node','ffmpeg'):
 subprocess.run([str(pkg/'native'/cfg[tool]),'--version' if tool=='node' else '-version'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
subprocess.run([str(exe),'--yt-dlp','--version'],check=True)
print('Packaged native host and bundled tools PASS')
