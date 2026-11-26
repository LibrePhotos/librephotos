param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$scales = @(100, 125, 150, 200, 400)
$maxEdge = 1024
$targetSizes = @(16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
$squares = [ordered]@{
  'StoreLogo'          = 50
  'Square44x44Logo'    = 44
  'Square71x71Logo'    = 71
  'Square150x150Logo'  = 150
  'Square310x310Logo'  = 310
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$icon = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$probe = New-Object System.Drawing.Bitmap $icon
$background = $probe.GetPixel(2, 2)
$probe.Dispose()

function Save-Png([int]$width, [int]$height, [string]$name, [bool]$fill) {
  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  if ($fill) {
    $brush = New-Object System.Drawing.SolidBrush $background
    $graphics.FillRectangle($brush, 0, 0, $width, $height)
    $brush.Dispose()
  }
  $edge = [Math]::Min($width, $height)
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $target = New-Object System.Drawing.Rectangle ([int](($width - $edge) / 2)), ([int](($height - $edge) / 2)), $edge, $edge
  $graphics.DrawImage($icon, $target, 0, 0, $icon.Width, $icon.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $attributes.Dispose()
  $graphics.Dispose()
  $bitmap.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

foreach ($entry in $squares.GetEnumerator()) {
  foreach ($scale in $scales) {
    $edge = [int][Math]::Round($entry.Value * $scale / 100)
    if ($edge -le $maxEdge) { Save-Png $edge $edge "$($entry.Key).scale-$scale.png" $false }
  }
}
foreach ($scale in $scales) {
  $width = [int][Math]::Round(310 * $scale / 100)
  $height = [int][Math]::Round(150 * $scale / 100)
  if ($width -le $maxEdge) { Save-Png $width $height "Wide310x150Logo.scale-$scale.png" $true }
}
foreach ($size in $targetSizes) {
  foreach ($suffix in @('', '_altform-unplated', '_altform-lightunplated')) {
    Save-Png $size $size "Square44x44Logo.targetsize-$size$suffix.png" $false
  }
}
$icon.Dispose()
