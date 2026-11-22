<#
.SYNOPSIS
    Installs, updates, or cleanly uninstalls the Antigravity IDE Prompt Enhancer extension and UI hook.
.PARAMETER ExtensionRoot
    Target VS Code / Antigravity extensions directory. Defaults to $env:ANTIGRAVITY_EXTENSIONS_DIR or $env:USERPROFILE\.antigravity-ide\extensions.
.PARAMETER IdeAppRoot
    Path to Antigravity IDE resources\app directory. Auto-detected via $env:ANTIGRAVITY_IDE_APP_ROOT or standard install paths if omitted.
.PARAMETER Uninstall
    Restores original workbench/extension backups (.enhancer.bak), unregisters the extension, and removes installed files.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$ExtensionRoot = $(if ($env:ANTIGRAVITY_EXTENSIONS_DIR) { $env:ANTIGRAVITY_EXTENSIONS_DIR } else { Join-Path $env:USERPROFILE ".antigravity-ide\extensions" }),

    [Parameter()]
    [string]$IdeAppRoot = $(if ($env:ANTIGRAVITY_IDE_APP_ROOT) { $env:ANTIGRAVITY_IDE_APP_ROOT } else { "" }),

    [Parameter()]
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-IdeAppRoot {
    param([string]$ExplicitRoot)
    if ($ExplicitRoot) {
        return $ExplicitRoot
    }
    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Antigravity IDE\resources\app")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Antigravity IDE\resources\app")
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Antigravity IDE\resources\app")
    }
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c -PathType Container) {
            return $c
        }
    }
    return $(if ($candidates.Count -gt 0) { $candidates[0] } else { "" })
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Get-Sha256Base64NoPad {
    param([Parameter(Mandatory = $true)][string]$FilePath)
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
        return [Convert]::ToBase64String($hash).TrimEnd('=')
    } finally {
        $sha.Dispose()
    }
}

function Sync-ProductJsonChecksums {
    param([string]$AppRoot)
    if (-not $AppRoot) { return $false }
    $pjPath = Join-Path $AppRoot "product.json"
    if (-not (Test-Path -LiteralPath $pjPath)) { return $false }

    $rawText = [System.IO.File]::ReadAllText($pjPath, [System.Text.UTF8Encoding]::new($false))
    $cleanText = if ($rawText.Length -gt 0 -and $rawText[0] -eq [char]0xFEFF) { $rawText.Substring(1) } else { $rawText }
    $parsed = $cleanText | ConvertFrom-Json
    if (-not $parsed -or -not $parsed.checksums) { return $false }

    $targetKeys = @(
        "vs/code/electron-browser/workbench/workbench.html",
        "vs/code/electron-browser/workbench/workbench-jetski-agent.html"
    )

    $updates = @()
    foreach ($relKey in $targetKeys) {
        $prop = $parsed.checksums.PSObject.Properties[$relKey]
        if (-not $prop) { continue }
        $diskPath = Join-Path $AppRoot (Join-Path "out" ($relKey -replace "/", "\"))
        if (-not (Test-Path -LiteralPath $diskPath)) { continue }
        $expected = [string]$prop.Value
        $actual = Get-Sha256Base64NoPad -FilePath $diskPath
        if ($expected -ne $actual) {
            $updates += [pscustomobject]@{ Key = $relKey; Expected = $expected; Actual = $actual }
            $prop.Value = $actual
        }
    }

    if ($updates.Count -eq 0) { return $false }

    $nextText = $cleanText
    $allReplaced = $true
    foreach ($u in $updates) {
        $pattern = '("' + [regex]::Escape($u.Key) + '"\s*:\s*")' + [regex]::Escape($u.Expected) + '(")'
        if ($nextText -match $pattern) {
            $nextText = [regex]::Replace($nextText, $pattern, ('$1' + $u.Actual + '$2'), 1)
        } else {
            $allReplaced = $false
            break
        }
    }

    if (-not $allReplaced) {
        $nextText = ($parsed | ConvertTo-Json -Depth 16)
    }

    Write-Utf8NoBom -Path $pjPath -Content $nextText
    Write-Host "Synchronized product.json workbench checksums" -ForegroundColor Green
    return $true
}

$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgPath = Join-Path $srcDir "package.json"
$pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$extPublisher = if ($pkg.publisher) { [string]$pkg.publisher } else { "kyuzan0" }
$extName = if ($pkg.name) { [string]$pkg.name } else { "ag-ide-prompt-enhancer" }
$extVersion = if ($pkg.version) { [string]$pkg.version } else { "1.1.0" }
$extId = "$extPublisher.$extName"
$legacyExtId = "local.antigravity-prompt-enhancer"
$extFolderName = "$extId-$extVersion-universal"
$dstDir = Join-Path $ExtensionRoot $extFolderName
$extJsonPath = Join-Path $ExtensionRoot "extensions.json"
$resolvedAppRoot = Resolve-IdeAppRoot -ExplicitRoot $IdeAppRoot
$wbDir = if ($resolvedAppRoot) { Join-Path $resolvedAppRoot "out\vs\code\electron-browser\workbench" } else { "" }
$agyExtJs = if ($resolvedAppRoot) { Join-Path $resolvedAppRoot "extensions\agy\vscode\extension.js" } else { "" }

if ($Uninstall) {
    if ($wbDir -and (Test-Path -LiteralPath $wbDir)) {
        foreach ($name in @("workbench.html", "workbench-jetski-agent.html")) {
            $hp = Join-Path $wbDir $name
            $bak = "$hp.enhancer.bak"
            if ((Test-Path -LiteralPath $bak) -and $PSCmdlet.ShouldProcess($hp, "Restore original $name from backup")) {
                Copy-Item -LiteralPath $bak -Destination $hp -Force
                Remove-Item -LiteralPath $bak -Force
                Write-Host "Restored $name" -ForegroundColor Green
            }
        }
        foreach ($extra in @("enhance-ide-hook.js", "enhance-ide-hook-config.json")) {
            $ep = Join-Path $wbDir $extra
            if ((Test-Path -LiteralPath $ep) -and $PSCmdlet.ShouldProcess($ep, "Remove $extra")) {
                Remove-Item -LiteralPath $ep -Force
            }
        }
    }

    if ($resolvedAppRoot -and $PSCmdlet.ShouldProcess((Join-Path $resolvedAppRoot "product.json"), "Restore workbench checksums in product.json")) {
        [void](Sync-ProductJsonChecksums -AppRoot $resolvedAppRoot)
    }

    if ($agyExtJs -and (Test-Path -LiteralPath "$agyExtJs.enhancer.bak")) {
        if ($PSCmdlet.ShouldProcess($agyExtJs, "Restore extensions\agy\vscode\extension.js from backup")) {
            Copy-Item -LiteralPath "$agyExtJs.enhancer.bak" -Destination $agyExtJs -Force
            Remove-Item -LiteralPath "$agyExtJs.enhancer.bak" -Force
            Write-Host "Restored extensions\agy\vscode\extension.js" -ForegroundColor Green
        }
    }

    if (Test-Path -LiteralPath $extJsonPath) {
        $raw = Get-Content -LiteralPath $extJsonPath -Raw -Encoding UTF8
        if ($raw -and $raw.Trim()) {
            $parsed = $raw | ConvertFrom-Json
            $kept = @($parsed | Where-Object { $_.identifier.id -ne $extId -and $_.identifier.id -ne $legacyExtId })
            if ($PSCmdlet.ShouldProcess($extJsonPath, "Unregister $extId")) {
                Write-Utf8NoBom -Path $extJsonPath -Content ($kept | ConvertTo-Json -Depth 8 -Compress)
            }
        }
    }

    if ((Test-Path -LiteralPath $dstDir) -and $PSCmdlet.ShouldProcess($dstDir, "Remove installed extension folder")) {
        Remove-Item -LiteralPath $dstDir -Recurse -Force
        Write-Host "Removed $dstDir" -ForegroundColor Green
    }

    if (Test-Path -LiteralPath $ExtensionRoot) {
        foreach ($oldDir in Get-ChildItem -LiteralPath $ExtensionRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$extId-*" -or $_.Name -like "$legacyExtId-*" }) {
            if ($PSCmdlet.ShouldProcess($oldDir.FullName, "Remove prior/legacy extension folder")) {
                Remove-Item -LiteralPath $oldDir.FullName -Recurse -Force
                Write-Host "Removed $($oldDir.FullName)" -ForegroundColor Green
            }
        }
    }

    Write-Host "[IDE ENHANCER UNINSTALLED]" -ForegroundColor Green
    return
}

if (-not (Test-Path -LiteralPath $ExtensionRoot)) {
    if ($PSCmdlet.ShouldProcess($ExtensionRoot, "Create extensions root directory")) {
        New-Item -ItemType Directory -Path $ExtensionRoot -Force | Out-Null
    }
}
if (-not (Test-Path -LiteralPath $dstDir)) {
    if ($PSCmdlet.ShouldProcess($dstDir, "Create extension directory")) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
}

foreach ($f in @("package.json", "extension.js", "enhance-ide-hook.js")) {
    $srcFile = Join-Path $srcDir $f
    $dstFile = Join-Path $dstDir $f
    if ($PSCmdlet.ShouldProcess($dstFile, "Copy $f")) {
        Copy-Item -LiteralPath $srcFile -Destination $dstFile -Force
    }
}
foreach ($optFile in @("LICENSE", "README.md")) {
    $srcOpt = Join-Path $srcDir $optFile
    if (Test-Path -LiteralPath $srcOpt) {
        $dstOpt = Join-Path $dstDir $optFile
        if ($PSCmdlet.ShouldProcess($dstOpt, "Copy $optFile")) {
            Copy-Item -LiteralPath $srcOpt -Destination $dstOpt -Force
        }
    }
}

if (Test-Path -LiteralPath $ExtensionRoot) {
    foreach ($legacyDir in Get-ChildItem -LiteralPath $ExtensionRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "$legacyExtId-*" }) {
        if ($PSCmdlet.ShouldProcess($legacyDir.FullName, "Remove legacy extension folder")) {
            Remove-Item -LiteralPath $legacyDir.FullName -Recurse -Force
        }
    }
}

# Register in extensions.json so Antigravity IDE loads it immediately.
$entries = @()
if (Test-Path -LiteralPath $extJsonPath) {
    $raw = Get-Content -LiteralPath $extJsonPath -Raw -Encoding UTF8
    if ($raw -and $raw.Trim()) {
        $parsed = $raw | ConvertFrom-Json
        if ($parsed -is [System.Array]) {
            $entries = @($parsed | Where-Object { $_.identifier.id -ne $extId -and $_.identifier.id -ne $legacyExtId })
        } elseif ($parsed) {
            if ($parsed.identifier.id -ne $extId -and $parsed.identifier.id -ne $legacyExtId) { $entries = @($parsed) }
        }
    }
}

$posixPath = "/" + ($dstDir -replace "\\", "/")
$newEntry = [ordered]@{
    identifier = @{ id = $extId }
    version = $extVersion
    location = @{
        "`$mid" = 1
        fsPath = $dstDir
        external = "file:///$($dstDir -replace '\\','/')"
        path = $posixPath
        scheme = "file"
    }
    relativeLocation = $extFolderName
    metadata = @{
        installedTimestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        pinned = $true
        source = "vsix"
        isApplicationScoped = $false
        isMachineScoped = $false
        isBuiltin = $false
        updated = $false
    }
}
$entries += $newEntry
if ($PSCmdlet.ShouldProcess($extJsonPath, "Register $extId in extensions.json")) {
    Write-Utf8NoBom -Path $extJsonPath -Content ($entries | ConvertTo-Json -Depth 8 -Compress)
}

# Pre-install the hook script & script tag into Antigravity IDE workbench HTMLs.
if ($wbDir -and (Test-Path -LiteralPath $wbDir)) {
    $dstHook = Join-Path $wbDir "enhance-ide-hook.js"
    if ($PSCmdlet.ShouldProcess($dstHook, "Install enhance-ide-hook.js into workbench")) {
        Copy-Item -LiteralPath (Join-Path $srcDir "enhance-ide-hook.js") -Destination $dstHook -Force
    }
    $tag = '<script src="./enhance-ide-hook.js" type="module"></script>'
    foreach ($item in @(
        @{ file = "workbench.html"; anchor = '<script src="./workbench.js" type="module"></script>' },
        @{ file = "workbench-jetski-agent.html"; anchor = '<script src="./jetskiAgent.js" type="module"></script>' }
    )) {
        $hp = Join-Path $wbDir $item.file
        if (-not (Test-Path -LiteralPath $hp)) { continue }
        $content = [System.IO.File]::ReadAllText($hp, [System.Text.UTF8Encoding]::new($false))
        if ($content.Length -gt 0 -and $content[0] -eq [char]0xFEFF) { $content = $content.Substring(1) }
        if ($content -notmatch "enhance-ide-hook\.js") {
            $bak = "$hp.enhancer.bak"
            if ($PSCmdlet.ShouldProcess($hp, "Patch $($item.file) with enhance-ide-hook.js")) {
                Copy-Item -LiteralPath $hp -Destination $bak -Force
                if ($content.Contains($item.anchor)) {
                    $content = $content.Replace($item.anchor, "$($item.anchor)`n$tag")
                } else {
                    $content = $content.Replace("</html>", "$tag`n</html>")
                }
                Write-Utf8NoBom -Path $hp -Content $content
                Write-Host "Patched $($item.file)" -ForegroundColor Green
            }
        } else {
            Write-Host "$($item.file) already patched" -ForegroundColor DarkGray
        }
    }
    if ($resolvedAppRoot -and $PSCmdlet.ShouldProcess((Join-Path $resolvedAppRoot "product.json"), "Synchronize workbench checksums in product.json")) {
        [void](Sync-ProductJsonChecksums -AppRoot $resolvedAppRoot)
    }
} elseif ($resolvedAppRoot) {
    Write-Host "Antigravity IDE workbench directory not found at $wbDir (skipping workbench pre-patch)" -ForegroundColor Yellow
}

# Pre-patch Antigravity built-in agy extension iframe loader so sidebar webview routes through our local enhancer proxy.
if ($agyExtJs -and (Test-Path -LiteralPath $agyExtJs)) {
    $marker = '/*AGY_ENHANCER_IFRAME_HOOK*/'
    $extContent = [System.IO.File]::ReadAllText($agyExtJs, [System.Text.UTF8Encoding]::new($false))
    if ($extContent.Length -gt 0 -and $extContent[0] -eq [char]0xFEFF) { $extContent = $extContent.Substring(1) }
    if ($extContent -notmatch [regex]::Escape($marker)) {
        $matchedTarget = $null
        $urlVar = 'd'
        $exactTarget = 'renderIframe(a,b,c){var d=this.buildIframeUrl(b,c);'
        if ($extContent.Contains($exactTarget)) {
            $matchedTarget = $exactTarget
        } elseif ($extContent -match '(renderIframe\([^)]*\)\{\s*(?:var|let|const)\s+([a-zA-Z0-9_$]+)\s*=\s*this\.buildIframeUrl\([^;]+\);)') {
            $matchedTarget = $Matches[1]
            $urlVar = $Matches[2]
        }

        if ($matchedTarget) {
            $bak = "$agyExtJs.enhancer.bak"
            if ($PSCmdlet.ShouldProcess($agyExtJs, "Patch renderIframe with enhancer proxy redirect")) {
                Copy-Item -LiteralPath $agyExtJs -Destination $bak -Force
                $hookExpr = $marker + $urlVar + '=((u)=>{try{const p=require("path").join(__dirname,"..","..","..","out","vs","code","electron-browser","workbench","enhance-ide-hook-config.json");const cfg=JSON.parse(require("fs").readFileSync(p,"utf8"));if(cfg&&cfg.port&&/^http:\/\/127\.0\.0\.1:(\d+)/.test(u)){const x=new URL(u);x.searchParams.set("__agy_hub",x.port);x.port=String(cfg.port);return x.toString()}}catch{}return u})(' + $urlVar + ');'
                $extContent = $extContent.Replace($matchedTarget, $matchedTarget + $hookExpr)
                Write-Utf8NoBom -Path $agyExtJs -Content $extContent
                Write-Host "Patched extensions\agy\vscode\extension.js" -ForegroundColor Green
            }
        } else {
            Write-Host "renderIframe signature not found in extensions\agy\vscode\extension.js" -ForegroundColor Yellow
        }
    } else {
        Write-Host "extensions\agy\vscode\extension.js already patched" -ForegroundColor DarkGray
    }
}

Write-Host "[IDE ENHANCER INSTALLED] $dstDir" -ForegroundColor Green
