param([string]$Emsdk = $env:EMSDK)
$ErrorActionPreference = 'Stop'
if (!$Emsdk) { throw 'Emsdkを指定してください: ./web/build.ps1 -Emsdk C:/path/to/emsdk' }
$projectRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $Emsdk 'upstream/emscripten/emcmake.bat') cmake -S $PSScriptRoot -B (Join-Path $projectRoot 'build-web') -G Ninja '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'
if ($LASTEXITCODE) { throw '構成に失敗しました' }
cmake --build (Join-Path $projectRoot 'build-web') --parallel
if ($LASTEXITCODE) { throw 'ビルドに失敗しました' }
