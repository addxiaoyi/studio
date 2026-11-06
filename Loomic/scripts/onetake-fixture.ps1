param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$target = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $target -Force | Out-Null
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speech.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
  $speech.SetOutputToWaveFile((Join-Path $target 'speech.wav'))
  $speech.Speak('Welcome to the video editor. We can edit a video by changing the transcript. Please keep this sentence and export the finished video.')
} finally { $speech.Dispose() }
& ffmpeg -hide_banner -loglevel error -nostdin -f lavfi -i 'testsrc2=size=640x360:rate=30' -i (Join-Path $target 'speech.wav') -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -y (Join-Path $target 'speech.mp4')
if ($LASTEXITCODE -ne 0) { throw 'Unable to create isolated speech video.' }
Write-Output "SPEECH_FIXTURE $target"
