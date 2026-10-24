# Speak one sentence with Cartesia and play it, to hear the voice and check emotion/speed by ear.
# The key is read from .env (CARTESIA_API_KEY=...); never write it in this file.
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/test_cartesia.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/test_cartesia.ps1 -Emotion calm -Speed 0.8
param(
    [string]$Text = "I can help with your financial aid hold. Let's take it one step at a time.",
    [string]$Emotion = "neutral",
    [double]$Speed = 1.0
)

$envFile = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envFile)) { throw "No .env in the repo root. Copy .env.example to .env and fill in CARTESIA_API_KEY." }
$values = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $values[$Matches[1]] = $Matches[2].Trim().Trim('"') }
}
if (-not $values["CARTESIA_API_KEY"]) { throw "CARTESIA_API_KEY is empty in .env" }
$voice = if ($values["CARTESIA_VOICE_ID"]) { $values["CARTESIA_VOICE_ID"] } else { "cbaf8084-f009-4838-a096-07ee2e6612b1" }  # Maya, the app's default

$body = @{
    model_id          = "sonic-3.6"
    transcript        = $Text
    voice             = $voice
    output_format     = @{ container = "wav"; encoding = "pcm_s16le"; sample_rate = 44100 }
    generation_config = @{ speed = $Speed; volume = 1; emotion = $Emotion }
} | ConvertTo-Json -Depth 5 -Compress

$out = Join-Path $env:TEMP "eqai-cartesia-test.wav"  # outside the repo: audio files are never committed
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "https://api.cartesia.ai/tts/bytes" -OutFile $out `
    -ContentType "application/json" -Body ([Text.Encoding]::UTF8.GetBytes($body)) `
    -Headers @{ "Cartesia-Version" = "2026-08-14"; "X-API-Key" = $values["CARTESIA_API_KEY"] }
Write-Host "Saved $out ($Emotion, speed $Speed). Playing..."
(New-Object Media.SoundPlayer $out).PlaySync()
