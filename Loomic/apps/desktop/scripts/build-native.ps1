$ErrorActionPreference = 'Stop'
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio C++ Build Tools with the Windows SDK to build the UI Automation helper.' }
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'The Windows C++ build tools were not found.' }
$devCmd = Join-Path $vsRoot 'Common7\Tools\VsDevCmd.bat'
$source = Join-Path $desktopRoot 'native\windows-uia.cpp'
$output = Join-Path $desktopRoot 'resources\native'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe = Join-Path $output 'helstera-uia.exe'
$obj = Join-Path $output 'windows-uia.obj'
& $env:ComSpec /d /s /c "`"$devCmd`" -no_logo -arch=x64 && cl /nologo /utf-8 /std:c++17 /EHsc /W4 /WX /MT /DUNICODE /D_UNICODE /Fo`"$obj`" /Fe`"$exe`" `"$source`" user32.lib ole32.lib oleaut32.lib"
if ($LASTEXITCODE -ne 0) { throw 'Windows UI Automation helper build failed.' }
& $exe version
if ($LASTEXITCODE -ne 0) { throw 'Windows UI Automation helper protocol probe failed.' }
