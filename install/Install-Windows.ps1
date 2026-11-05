$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'native\rium-download-host.exe') --install
if($LASTEXITCODE -ne 0){throw 'Installation failed'}
