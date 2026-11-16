Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$outDir = Join-Path $PSScriptRoot '../assets/images/menubar-icons/win32/flags'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$srcDir = Join-Path $env:TEMP 'mullvad-tray-flags-src'
New-Item -ItemType Directory -Force -Path $srcDir | Out-Null

$codes = (Invoke-WebRequest -Uri 'https://flagcdn.com/en/codes.json' -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
$codeList = $codes.PSObject.Properties.Name | Sort-Object

$canvasSize = 32
$maxFlagWidth = 30
$maxFlagHeight = 24

$done = 0
foreach ($code in $codeList) {
  $src = Join-Path $srcDir "$code.png"
  if (-not (Test-Path $src)) {
    try {
      Invoke-WebRequest -Uri "https://flagcdn.com/w160/$code.png" -OutFile $src -UseBasicParsing -TimeoutSec 20
    } catch {
      Write-Warning "Skipping $code"
      continue
    }
  }

  $image = [System.Drawing.Image]::FromFile($src)
  try {
    $canvas = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

        $scale = [Math]::Min($maxFlagWidth / $image.Width, $maxFlagHeight / $image.Height)
        $width = [int][Math]::Round($image.Width * $scale)
        $height = [int][Math]::Round($image.Height * $scale)
        $x = [int][Math]::Floor(($canvasSize - $width) / 2)
        $y = [int][Math]::Floor(($canvasSize - $height) / 2)

        $graphics.DrawImage($image, $x, $y, $width, $height)
      } finally {
        $graphics.Dispose()
      }

      $canvas.Save((Join-Path $outDir "$code.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $canvas.Dispose()
    }
  } finally {
    $image.Dispose()
  }

  $done++
}

Write-Output "Generated $done flag icons in $outDir"
