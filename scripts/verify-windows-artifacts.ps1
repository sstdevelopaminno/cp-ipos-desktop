# Windows artifact integrity gate (does not constitute hardware acceptance).
[CmdletBinding()]
param([string]$BundleRoot = "src-tauri/target/release/bundle",[switch]$RequireAuthenticode)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path $BundleRoot).Path
$manifestPath = Join-Path $root "installer-integrity.json"
$records = @()
$groups = @(
  @{ Name = "NSIS"; Folder = "nsis"; Extension = ".exe"; Magic = "4D5A" },
  @{ Name = "MSI"; Folder = "msi"; Extension = ".msi"; Magic = "D0CF11E0A1B11AE1" }
)
foreach ($group in $groups) {
  $dir = Join-Path $root $group.Folder
  if (-not (Test-Path $dir -PathType Container)) { throw "MISSING_BUNDLE_DIRECTORY: $dir" }
  $files = @(Get-ChildItem -Path $dir -File | Where-Object { $_.Extension -eq $group.Extension })
  if ($files.Count -ne 1) { throw "EXPECTED_ONE_$($group.Name)_INSTALLER_FOUND_$($files.Count)" }
  $installer = $files[0]
  if ($installer.Length -lt 50000) { throw "INSTALLER_TOO_SMALL: $($installer.Name)" }
  $stream = [System.IO.File]::OpenRead($installer.FullName)
  try {
    $count = [int]($group.Magic.Length / 2)
    $header = New-Object byte[] $count
    if ($stream.Read($header, 0, $count) -ne $count) { throw "INSTALLER_TRUNCATED: $($installer.Name)" }
    $magic = -join ($header | ForEach-Object { $_.ToString("X2") })
    if ($magic -ne $group.Magic) { throw "INSTALLER_MAGIC_MISMATCH: $($installer.Name)" }
  } finally { $stream.Dispose() }
  $sidecar = "$($installer.FullName).sig"
  if (-not (Test-Path $sidecar -PathType Leaf)) { throw "MISSING_TAURI_UPDATER_SIGNATURE: $sidecar" }
  if ((Get-Item $sidecar).Length -lt 64) { throw "INVALID_SIGNATURE_SIDECAR_LENGTH: $sidecar" }
  $auth = Get-AuthenticodeSignature -FilePath $installer.FullName
  if ($RequireAuthenticode -and $auth.Status -ne 'Valid') {
    throw "WINDOWS_AUTHENTICODE_NOT_VALID: $($installer.Name): $($auth.Status)"
  }
  $hash = (Get-FileHash -Path $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $records += [ordered]@{
    format = $group.Name
    name = $installer.Name
    bytes = $installer.Length
    sha256 = $hash
    tauriUpdaterSignature = (Split-Path $sidecar -Leaf)
    authenticodeStatus = [string]$auth.Status
    authenticodeSigner = if ($auth.SignerCertificate) { $auth.SignerCertificate.Subject } else { $null }
  }
}
$manifest = [ordered]@{
  kind = "CpIPOS Desktop Windows installer integrity (packaging evidence only)"
  commit = "$env:GITHUB_SHA"
  collectedAtUtc = [DateTime]::UtcNow.ToString("o")
  authenticodeRequired = [bool]$RequireAuthenticode
  passesPackageChecks = $true
  hardwareAcceptance = "NOT_TESTED"
  cleanInstallAcceptance = "NOT_TESTED"
  installers = $records
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "Validated bundle and generated $manifestPath"
foreach ($entry in $records) {
  Write-Host ("{0}: {1} | SHA256={2} | Authenticode={3}" -f $entry.format, $entry.name, $entry.sha256, $entry.authenticodeStatus)
}
if ($env:GITHUB_STEP_SUMMARY) {
  Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Windows installer integrity (not hardware acceptance)"
  foreach ($entry in $records) {
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ("- {0}: SHA-256 {1}, Authenticode {2}" -f $entry.name, $entry.sha256, $entry.authenticodeStatus)
  }
  Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "Physical printer, scanner, clean install and end-user acceptance remain unverified."
}
