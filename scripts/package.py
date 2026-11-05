from pathlib import Path
import json,shutil,os,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'/('Rium-Download-'+sys.platform+'-'+os.environ.get('RIUM_ARCH','x64'))
OUT.mkdir(parents=True,exist_ok=True)
shutil.copytree(ROOT/'extension',OUT/'extension',dirs_exist_ok=True)
N=OUT/'native';N.mkdir(exist_ok=True)
import imageio_ffmpeg
ff=Path(imageio_ffmpeg.get_ffmpeg_exe());node=Path(shutil.which('node'))
T=N/'tools';T.mkdir(exist_ok=True)
shutil.copy2(ff,T/('ffmpeg.exe' if os.name=='nt' else 'ffmpeg'))
shutil.copy2(node,T/('node.exe' if os.name=='nt' else 'node'))
cmd=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','rium-download-host','--distpath',str(ROOT/'build/native'),'--workpath',str(ROOT/'build/work'),'--specpath',str(ROOT/'build'),'--collect-all','yt_dlp','--collect-all','yt_dlp_ejs',str(ROOT/'native/host.py')]
subprocess.run(cmd,check=True)
shutil.copytree(ROOT/'build/native/rium-download-host',N,dirs_exist_ok=True)
m=json.loads((OUT/'extension/manifest.json').read_text('utf-8-sig'));import base64,hashlib
ident=''.join(chr(97+int(c,16)) for c in hashlib.sha256(base64.b64decode(m['key'])).hexdigest()[:32])
cfg={'ffmpeg':'tools/'+('ffmpeg.exe' if os.name=='nt' else 'ffmpeg'),'node':'tools/'+('node.exe' if os.name=='nt' else 'node'),'allowed_origins':['chrome-extension://'+ident+'/']}
(N/'config.json').write_text(json.dumps(cfg,indent=2),'utf-8')
for name in ('README.md','LICENSE','THIRD-PARTY.md'):
 shutil.copy2(ROOT/name,OUT/name)
for name in (('Install-Windows.cmd','Install-Windows.ps1') if os.name=='nt' else ('Install-macOS.command',)):
 shutil.copy2(ROOT/'install'/name,OUT/name)
 if os.name!='nt':(OUT/name).chmod(0o755)
licenses=OUT/'licenses';licenses.mkdir()
import importlib.metadata
for name in ('yt-dlp','yt-dlp-ejs','imageio-ffmpeg','pyinstaller'):
 try:
  d=importlib.metadata.distribution(name)
  for f in d.files or []:
   if 'license' in str(f).lower() and d.locate_file(f).is_file():shutil.copy2(d.locate_file(f),licenses/(name+'-'+Path(f).name))
 except importlib.metadata.PackageNotFoundError:pass
import urllib.request
node_version=subprocess.check_output([str(node),'--version'],text=True).strip()
with urllib.request.urlopen('https://raw.githubusercontent.com/nodejs/node/'+node_version+'/LICENSE',timeout=30) as response:
 (licenses/'node-license.txt').write_bytes(response.read())
python_license=Path(sys.base_prefix)/('LICENSE.txt' if os.name=='nt' else 'lib/python'+str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'/LICENSE.txt')
if python_license.exists():shutil.copy2(python_license,licenses/'python-license.txt')
(licenses/'ffmpeg-build.txt').write_bytes(subprocess.check_output([str(ff),'-version'],stderr=subprocess.STDOUT))
shutil.make_archive(str(OUT),'zip',OUT.parent,OUT.name)
print(OUT.with_suffix('.zip'))
