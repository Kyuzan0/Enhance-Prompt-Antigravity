<#
.SYNOPSIS
    Transactional Activation & Safe Replacement Script for Antigravity Prompt Enhancer.
.DESCRIPTION
    Executed exclusively by GOA (Controller) after graceful session stops.
    Validates candidate binary hash, ensures targets are unlocked, creates verified
    timestamped backups outside Git, stages payloads, performs atomic replacement
    with automatic transactional rollback on failure, and verifies native Google CLI integrity.
    DOES NOT perform blanket process termination or modify agent global settings.
    NOTE: Default CandidatePath/ExpectedSHA256 remain pinned to the legacy isolated
    baseline (04CD...); for deploying newly built ConPTY wrapper binaries from source,
    use `scripts/prompt-enhancer/wrapper/build.ps1 -Deploy` or override `-CandidatePath`
    and `-ExpectedSHA256` explicitly.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    # Relocated default: legacy activation candidate (SHA-256 04CD...), NOT the native isolated_next build (694beb...).
    [string]$CandidatePath = "",

    [Parameter()]
    [string]$ExpectedSHA256 = "04CD0F7E59F7BBD4C1E7A72766D52D225F7842D7B4129D447C5B55B363128D17",

    [Parameter()]
    [string]$AgyExePath = "",

    [Parameter()]
    [string]$AgyWrapExePath = "",

    [Parameter()]
    [string]$AgyRealExePath = "",

    [Parameter()]
    [string]$BackupBaseDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptParent = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRootDir = Split-Path -Parent (Split-Path -Parent $scriptParent)
$defaultBinDir = if ($env:AGY_BIN_DIR) { $env:AGY_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "agy\bin" }

if (-not $CandidatePath) {
    $CandidatePath = Join-Path $repoRootDir "scripts\prompt-enhancer\wrapper\build\isolated\agy.exe"
}
if (-not $AgyExePath) { $AgyExePath = Join-Path $defaultBinDir "agy.exe" }
if (-not $AgyWrapExePath) { $AgyWrapExePath = Join-Path $defaultBinDir "agy-wrap.exe" }
if (-not $AgyRealExePath) { $AgyRealExePath = Join-Path $defaultBinDir "agy-real.exe" }
if (-not $BackupBaseDir) { $BackupBaseDir = Join-Path $env:USERPROFILE ".gemini\antigravity-cli" }

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK")
    Write-Host "[$timestamp] [$Level] $Message"
}

Write-Log "Starting Prompt Enhancer Activation Pre-flight Checks..."

# 1. Validate Canonical Distinct Paths (No aliasing or collision)
$normCand    = [System.IO.Path]::GetFullPath($CandidatePath)
$normAgy     = [System.IO.Path]::GetFullPath($AgyExePath)
$normAgyWrap = [System.IO.Path]::GetFullPath($AgyWrapExePath)
$normAgyReal = [System.IO.Path]::GetFullPath($AgyRealExePath)

$allPaths = @($normCand, $normAgy, $normAgyWrap, $normAgyReal)
$uniquePaths = $allPaths | Select-Object -Unique
if ($uniquePaths.Count -ne 4) {
    throw "Path validation failure: All paths (candidate, agy.exe, agy-wrap.exe, agy-real.exe) must be distinct canonical paths! Duplicates detected."
}
Write-Log "Distinct canonical paths validated:"
Write-Log "  Candidate:    $normCand"
Write-Log "  Target 1:     $normAgy"
Write-Log "  Target 2:     $normAgyWrap"
Write-Log "  Protected:    $normAgyReal"

function Get-Sha256Safe {
    param([string]$LiteralPath)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($LiteralPath)
    try {
        $hashBytes = $sha.ComputeHash($fs)
        return ([System.BitConverter]::ToString($hashBytes) -replace '-', '').ToUpperInvariant()
    } finally {
        $fs.Dispose()
        $sha.Dispose()
    }
}

# 2. Validate Candidate Binary
if (-not (Test-Path -LiteralPath $normCand)) {
    throw "Candidate binary not found at: $normCand"
}
$actualCandHash = Get-Sha256Safe -LiteralPath $normCand
if ($actualCandHash -ne $ExpectedSHA256) {
    throw "Candidate binary SHA-256 mismatch! Expected: $ExpectedSHA256, Actual: $actualCandHash"
}
Write-Log "Candidate binary validated: $normCand (SHA-256: $actualCandHash)"

# 3. Check for File Locks (Zero Mutation if Locked)
function Test-FileUnlocked {
    param([string]$FilePath)
    try {
        $fileStream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        if ($fileStream) {
            $fileStream.Close()
            $fileStream.Dispose()
        }
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $normAgy)) {
    throw "Target agy.exe not found at: $normAgy"
}
if (-not (Test-Path -LiteralPath $normAgyWrap)) {
    throw "Target agy-wrap.exe not found at: $normAgyWrap"
}
if (-not (Test-Path -LiteralPath $normAgyReal)) {
    throw "Native Google CLI (agy-real.exe) not found at: $normAgyReal"
}

$agyLocked     = -not (Test-FileUnlocked -FilePath $normAgy)
$agyWrapLocked = -not (Test-FileUnlocked -FilePath $normAgyWrap)

if ($agyLocked -or $agyWrapLocked) {
    Write-Log "MUTATION BLOCKED: Target executables are currently locked by running processes." "WARN"
    Write-Log "Scanning locking process metadata (sanitized, no secrets)..." "INFO"
    
    $lockingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -eq $normAgy -or $_.ExecutablePath -eq $normAgyWrap
    } | Select-Object ProcessId, Name, ExecutablePath, ParentProcessId)

    if ($lockingProcesses.Count -gt 0) {
        $lockingProcesses | Format-Table -AutoSize | Out-String | Write-Host
    } else {
        Write-Log "File lock held by external or sub-handle process." "WARN"
    }

    $pidList = if ($lockingProcesses.Count -gt 0) {
        ($lockingProcesses | ForEach-Object { $_.ProcessId }) -join ', '
    } else {
        "unknown"
    }

    if (-not $PSCmdlet.ShouldProcess("Targets: $normAgy, $normAgyWrap", "Activate candidate $normCand")) {
        Write-Log "[DRY-RUN] Pre-flight lock detection verified active sessions (PID: $pidList). WhatIf dry-run completed safely with zero disk mutations." "INFO"
        return
    }

    throw "Target executables are locked (PIDs: $pidList). Please gracefully stop or hibernate sessions before activation."
}
Write-Log "Both target executables are completely UNLOCKED. Safe for transactional mutation."

# 4. Capture Pre-mutation Hashes
$preAgyHash     = Get-Sha256Safe -LiteralPath $normAgy
$preAgyWrapHash = Get-Sha256Safe -LiteralPath $normAgyWrap
$preAgyRealHash = Get-Sha256Safe -LiteralPath $normAgyReal

Write-Log "Pre-mutation target hashes verified:"
Write-Log "  agy.exe:      $preAgyHash"
Write-Log "  agy-wrap.exe: $preAgyWrapHash"
Write-Log "  agy-real.exe: $preAgyRealHash (Protected Native)"

# 5. WhatIf / Dry-Run Interception (Unlocked Path)
if (-not $PSCmdlet.ShouldProcess("Targets: $normAgy, $normAgyWrap", "Activate candidate $normCand")) {
    Write-Log "[DRY-RUN] WhatIf verification succeeded on unlocked targets. No mutations performed on disk." "INFO"
    return
}

# 6. Create Unique GUID Backup Directory Outside Git (No Stale Overwrite)
$backupGuid = [guid]::NewGuid().ToString('N')
$uniqueBackupDir = Join-Path $BackupBaseDir "backup_prompt_enhancer_$backupGuid"
if (Test-Path -LiteralPath $uniqueBackupDir) {
    throw "Backup directory already exists: $uniqueBackupDir"
}
New-Item -ItemType Directory -Path $uniqueBackupDir -ErrorAction Stop | Out-Null

$backupAgyPath     = Join-Path $uniqueBackupDir "active_agy.exe.bak"
$backupAgyWrapPath = Join-Path $uniqueBackupDir "active_agy-wrap.exe.bak"
$backupAgyRealPath = Join-Path $uniqueBackupDir "active_agy-real.exe.bak"

# Copy backups without -Force (fail if destination exists)
Copy-Item -LiteralPath $normAgy -Destination $backupAgyPath -ErrorAction Stop
Copy-Item -LiteralPath $normAgyWrap -Destination $backupAgyWrapPath -ErrorAction Stop
Copy-Item -LiteralPath $normAgyReal -Destination $backupAgyRealPath -ErrorAction Stop

# Verify Backups Integrity
$bakAgyHash     = (Get-FileHash -LiteralPath $backupAgyPath -Algorithm SHA256).Hash
$bakAgyWrapHash = (Get-FileHash -LiteralPath $backupAgyWrapPath -Algorithm SHA256).Hash
$bakAgyRealHash = (Get-FileHash -LiteralPath $backupAgyRealPath -Algorithm SHA256).Hash

if ($bakAgyHash -ne $preAgyHash -or $bakAgyWrapHash -ne $preAgyWrapHash -or $bakAgyRealHash -ne $preAgyRealHash) {
    throw "Backup verification failed! Backup file hashes do not match pre-mutation sources."
}
Write-Log "Verified backups stored safely at: $uniqueBackupDir"

# 7. Unique GUID Staging Phase on Same Volume for Atomic Replace
$targetDir = Split-Path -Parent $normAgy
$stagingGuid = [guid]::NewGuid().ToString('N')
$stagingDir = Join-Path $targetDir ".staging_$stagingGuid"
if (Test-Path -LiteralPath $stagingDir) {
    throw "Staging directory already exists: $stagingDir"
}
New-Item -ItemType Directory -Path $stagingDir -ErrorAction Stop | Out-Null

$stagedAgy         = Join-Path $stagingDir "agy.exe.staged"
$stagedAgyWrap     = Join-Path $stagingDir "agy-wrap.exe.staged"
$atomicBakAgy     = Join-Path $stagingDir "agy.exe.atomic_bak"
$atomicBakAgyWrap = Join-Path $stagingDir "agy-wrap.exe.atomic_bak"

Copy-Item -LiteralPath $normCand -Destination $stagedAgy -ErrorAction Stop
Copy-Item -LiteralPath $normCand -Destination $stagedAgyWrap -ErrorAction Stop

$stagedHash1 = (Get-FileHash -LiteralPath $stagedAgy -Algorithm SHA256).Hash
$stagedHash2 = (Get-FileHash -LiteralPath $stagedAgyWrap -Algorithm SHA256).Hash

if ($stagedHash1 -ne $ExpectedSHA256 -or $stagedHash2 -ne $ExpectedSHA256) {
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    throw "Staged files hash mismatch. Aborting before mutation."
}
Write-Log "Staged candidate binaries prepared in: $stagingDir"

# 8. Atomic File.Replace with Transactional Rollback
$step1Success = $false
try {
    # Step A: Atomic replace agy.exe
    [System.IO.File]::Replace($stagedAgy, $normAgy, $atomicBakAgy, $true)
    $step1Success = $true
    Write-Log "Step 1: agy.exe atomically replaced with candidate binary."

    # Step B: Atomic replace agy-wrap.exe
    [System.IO.File]::Replace($stagedAgyWrap, $normAgyWrap, $atomicBakAgyWrap, $true)
    Write-Log "Step 2: agy-wrap.exe atomically replaced with candidate binary."
} catch {
    Write-Log "TRANSACTION FAILED during file replacement: $_" "ERROR"
    Write-Log "Initiating automatic transactional rollback..." "WARN"

    if ($step1Success) {
        Copy-Item -LiteralPath $backupAgyPath -Destination $normAgy -Force
        Write-Log "Rolled back agy.exe from backup."
    }
    Copy-Item -LiteralPath $backupAgyWrapPath -Destination $normAgyWrap -Force
    Write-Log "Rolled back agy-wrap.exe from backup."

    # Verify BOTH rolled-back targets match pre-mutation hashes
    $rollAgyHash = (Get-FileHash -LiteralPath $normAgy -Algorithm SHA256).Hash
    $rollAgyWrapHash = (Get-FileHash -LiteralPath $normAgyWrap -Algorithm SHA256).Hash
    $rollbackFailed = ($rollAgyHash -ne $preAgyHash -or $rollAgyWrapHash -ne $preAgyWrapHash)

    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue

    if ($rollbackFailed) {
        Write-Log "CRITICAL: Rollback hash verification FAILED! agy.exe: $rollAgyHash (expected: $preAgyHash), agy-wrap.exe: $rollAgyWrapHash (expected: $preAgyWrapHash)" "ERROR"
        throw "CRITICAL ACTIVATION FAILURE: Replacement failed and transactional rollback hash verification FAILED! agy.exe: $rollAgyHash (expected: $preAgyHash), agy-wrap.exe: $rollAgyWrapHash (expected: $preAgyWrapHash). Residual limitation: Target files may be partially reverted, corrupted, or locked. Manual recovery required from intact backup directory: $uniqueBackupDir"
    }

    Write-Log "Rollback verified: BOTH target executables restored to pre-mutation hashes." "INFO"
    throw "Activation failed during replacement. Transactional rollback successfully executed. Original files restored and verified matching pre-mutation hashes."
}

# 9. Post-Mutation Verification
$postAgyHash     = (Get-FileHash -LiteralPath $normAgy -Algorithm SHA256).Hash
$postAgyWrapHash = (Get-FileHash -LiteralPath $normAgyWrap -Algorithm SHA256).Hash
$postAgyRealHash = (Get-FileHash -LiteralPath $normAgyReal -Algorithm SHA256).Hash

if ($postAgyRealHash -ne $preAgyRealHash) {
    Write-Log "CRITICAL: Native Google CLI (agy-real.exe) was modified concurrently during activation! Initiating wrapper rollback..." "ERROR"
    Copy-Item -LiteralPath $backupAgyPath -Destination $normAgy -Force
    Copy-Item -LiteralPath $backupAgyWrapPath -Destination $normAgyWrap -Force
    
    $rollAgyHash = (Get-FileHash -LiteralPath $normAgy -Algorithm SHA256).Hash
    $rollAgyWrapHash = (Get-FileHash -LiteralPath $normAgyWrap -Algorithm SHA256).Hash
    $rollbackFailed = ($rollAgyHash -ne $preAgyHash -or $rollAgyWrapHash -ne $preAgyWrapHash)
    
    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    if ($rollbackFailed) {
        Write-Log "CRITICAL: Wrapper rollback hash verification FAILED! agy.exe: $rollAgyHash, agy-wrap.exe: $rollAgyWrapHash" "ERROR"
        throw "CRITICAL: Native Google CLI integrity violation (agy-real.exe changed concurrently) AND wrapper rollback hash verification FAILED! Residual limitation: Manual intervention required from backup: $uniqueBackupDir"
    }
    Write-Log "Wrappers rolled back and verified to pre-mutation state (agy: $rollAgyHash, agy-wrap: $rollAgyWrapHash)." "WARN"
    throw "Native Google CLI integrity violation: agy-real.exe changed concurrently. Rollback of wrappers executed and verified matching pre-mutation hashes."
}

if ($postAgyHash -ne $ExpectedSHA256 -or $postAgyWrapHash -ne $ExpectedSHA256) {
    Write-Log "Post-mutation hash mismatch! Triggering emergency rollback..." "ERROR"
    Copy-Item -LiteralPath $backupAgyPath -Destination $normAgy -Force
    Copy-Item -LiteralPath $backupAgyWrapPath -Destination $normAgyWrap -Force

    $rollAgyHash = (Get-FileHash -LiteralPath $normAgy -Algorithm SHA256).Hash
    $rollAgyWrapHash = (Get-FileHash -LiteralPath $normAgyWrap -Algorithm SHA256).Hash
    $rollbackFailed = ($rollAgyHash -ne $preAgyHash -or $rollAgyWrapHash -ne $preAgyWrapHash)

    Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    if ($rollbackFailed) {
        Write-Log "CRITICAL: Emergency rollback hash verification FAILED! agy.exe: $rollAgyHash, agy-wrap.exe: $rollAgyWrapHash" "ERROR"
        throw "CRITICAL: Post-mutation hash mismatch AND emergency rollback hash verification FAILED! Residual limitation: Manual intervention required from backup: $uniqueBackupDir"
    }
    Write-Log "Emergency rollback verified: target executables restored to pre-mutation hashes." "INFO"
    throw "Post-mutation hash mismatch. Emergency rollback executed and verified matching pre-mutation hashes."
}

# 10. Clean up staging directory
Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "=========================================================="
Write-Log "ACTIVATION COMPLETED SUCCESSFULLY!"
Write-Log "Installed agy.exe SHA-256:      $postAgyHash (MATCH)"
Write-Log "Installed agy-wrap.exe SHA-256: $postAgyWrapHash (MATCH)"
Write-Log "Protected agy-real.exe SHA-256: $postAgyRealHash (UNCHANGED)"
Write-Log "Rollback backups retained at:   $uniqueBackupDir"
Write-Log "=========================================================="