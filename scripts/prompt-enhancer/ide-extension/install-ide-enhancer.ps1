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

$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extId = "local.antigravity-prompt-enhancer"
$extFolderName = "local.antigravity-prompt-enhancer-1.0.0-universal"
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
            $kept = @($parsed | Where-Object { $_.identifier.id -ne $extId })
            if ($PSCmdlet.ShouldProcess($extJsonPath, "Unregister $extId")) {
                ($kept | ConvertTo-Json -Depth 8 -Compress) | Set-Content -LiteralPath $extJsonPath -Encoding UTF8
            }
        }
    }

    if ((Test-Path -LiteralPath $dstDir) -and $PSCmdlet.ShouldProcess($dstDir, "Remove installed extension folder")) {
        Remove-Item -LiteralPath $dstDir -Recurse -Force
        Write-Host "Removed $dstDir" -ForegroundColor Green
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

# Register in extensions.json so Antigravity IDE loads it immediately.
$entries = @()
if (Test-Path -LiteralPath $extJsonPath) {
    $raw = Get-Content -LiteralPath $extJsonPath -Raw -Encoding UTF8
    if ($raw -and $raw.Trim()) {
        $parsed = $raw | ConvertFrom-Json
        if ($parsed -is [System.Array]) {
            $entries = @($parsed | Where-Object { $_.identifier.id -ne $extId })
        } elseif ($parsed) {
            if ($parsed.identifier.id -ne $extId) { $entries = @($parsed) }
        }
    }
}

$posixPath = "/" + ($dstDir -replace "\\", "/")
$newEntry = [ordered]@{
    identifier = @{ id = $extId }
    version = "1.0.0"
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
    ($entries | ConvertTo-Json -Depth 8 -Compress) | Set-Content -LiteralPath $extJsonPath -Encoding UTF8
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
        $content = Get-Content -LiteralPath $hp -Raw -Encoding UTF8
        if ($content -notmatch "enhance-ide-hook\.js") {
            $bak = "$hp.enhancer.bak"
            if ($PSCmdlet.ShouldProcess($hp, "Patch $($item.file) with enhance-ide-hook.js")) {
                if (-not (Test-Path -LiteralPath $bak)) {
                    Set-Content -LiteralPath $bak -Value $content -Encoding UTF8 -NoNewline
                }
                if ($content.Contains($item.anchor)) {
                    $content = $content.Replace($item.anchor, "$($item.anchor)`n$tag")
                } else {
                    $content = $content.Replace("</html>", "$tag`n</html>")
                }
                Set-Content -LiteralPath $hp -Value $content -Encoding UTF8 -NoNewline
                Write-Host "Patched $($item.file)" -ForegroundColor Green
            }
        } else {
            Write-Host "$($item.file) already patched" -ForegroundColor DarkGray
        }
    }
} elseif ($resolvedAppRoot) {
    Write-Host "Antigravity IDE workbench directory not found at $wbDir (skipping workbench pre-patch)" -ForegroundColor Yellow
}

# Pre-patch Antigravity built-in agy extension iframe loader so sidebar webview routes through our local enhancer proxy.
if ($agyExtJs -and (Test-Path -LiteralPath $agyExtJs)) {
    $marker = '/*AGY_ENHANCER_IFRAME_HOOK*/'
    $extContent = Get-Content -LiteralPath $agyExtJs -Raw -Encoding UTF8
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
                if (-not (Test-Path -LiteralPath $bak)) {
                    Set-Content -LiteralPath $bak -Value $extContent -Encoding UTF8 -NoNewline
                }
                $hookExpr = $marker + $urlVar + '=((u)=>{try{const p=require("path").join(__dirname,"..","..","..","out","vs","code","electron-browser","workbench","enhance-ide-hook-config.json");const cfg=JSON.parse(require("fs").readFileSync(p,"utf8"));if(cfg&&cfg.port&&/^http:\/\/127\.0\.0\.1:(\d+)/.test(u)){const x=new URL(u);x.searchParams.set("__agy_hub",x.port);x.port=String(cfg.port);return x.toString()}}catch{}return u})(' + $urlVar + ');'
                $extContent = $extContent.Replace($matchedTarget, $matchedTarget + $hookExpr)
                Set-Content -LiteralPath $agyExtJs -Value $extContent -Encoding UTF8 -NoNewline
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
