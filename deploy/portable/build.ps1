param(
    [string]$NodePath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot 'release\慧眼智检-Windows-x64-20261020'
}
$artifactOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$archivePath = $artifactOutput + '.zip'
if ((Test-Path -LiteralPath $artifactOutput) -or (Test-Path -LiteralPath $archivePath)) {
    throw '输出目录或压缩包已存在，请使用新的 OutputDirectory；不会覆盖既有交付包。'
}

$runtimeVersion = 'v24.16.0'
$runtimeBase = "https://nodejs.org/dist/$runtimeVersion/"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$checksums = (Invoke-WebRequest -UseBasicParsing -Uri ($runtimeBase + 'SHASUMS256.txt')).Content
$checksumLine = @($checksums -split "`n" | Where-Object { $_.Trim() -match '\s+win-x64/node\.exe$' })
if ($checksumLine.Count -ne 1) { throw '官方发布清单未找到唯一 Windows x64 运行时。' }
$expectedHash = ($checksumLine[0].Trim() -split '\s+')[0]
$actualHash = (Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'Node运行时与官方SHA-256不一致，停止打包。' }
$actualVersion = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $actualVersion -ne $runtimeVersion) { throw '需要经校验的Windows x64 Node v24.16.0。' }

Push-Location (Join-Path $projectRoot 'web')
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw '前端生产构建失败。' }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $artifactOutput | Out-Null
foreach ($folder in @('app', 'runtime', 'licenses', 'logs', 'data')) {
    New-Item -ItemType Directory -Path (Join-Path $artifactOutput $folder) | Out-Null
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'web\dist') -Destination (Join-Path $artifactOutput 'site') -Recurse
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $artifactOutput 'runtime\node.exe')
foreach ($file in @('server.cjs', 'launcher.cjs')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $artifactOutput "app\$file")
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($file in @('启动平台.bat', '停止平台.bat')) {
    $text = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot $file))
    $text = ($text -replace "`r?`n", "`r`n")
    [System.IO.File]::WriteAllText((Join-Path $artifactOutput $file), $text, $utf8)
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '平台配置.json') -Destination $artifactOutput
$instructions = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot '使用说明.txt'))
[System.IO.File]::WriteAllText((Join-Path $artifactOutput '使用说明.txt'), ($instructions -replace "`r?`n", "`r`n"), $utf8Bom)

$nodeLicense = (Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$runtimeVersion/LICENSE").Content
[System.IO.File]::WriteAllText((Join-Path $artifactOutput 'licenses\NODE-LICENSE.txt'), $nodeLicense, $utf8)
[System.IO.File]::WriteAllText((Join-Path $artifactOutput 'licenses\NODE-SHASUMS256.txt'), $checksums, $utf8)
foreach ($dependency in @('react', 'react-dom', 'echarts', 'zrender', 'tslib', 'scheduler', 'loose-envify', 'js-tokens')) {
    $dependencyRoot = Join-Path $projectRoot "web\node_modules\$dependency"
    $license = @(Get-ChildItem -LiteralPath $dependencyRoot -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|CopyrightNotice)(\.|$)' })
    if ($license.Count -eq 0) { throw "依赖 $dependency 缺少许可证。" }
    foreach ($file in $license) {
        Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $artifactOutput "licenses\$dependency-$($file.Name)")
    }
}
foreach ($file in @('echarts-NOTICE.txt', 'tabler-icons-LICENSE.txt')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "web\public\assets\vendor\$file") -Destination (Join-Path $artifactOutput "licenses\$file")
}

$sourceCommit = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw '无法确定Git来源版本。' }
$webChanges = @(& git -C $projectRoot status --porcelain -- web)
$buildInfo = [ordered]@{
    product = 'huiyan-portable'
    source_commit = $sourceCommit
    frontend_worktree_changes = $webChanges
    built_at_utc = [DateTime]::UtcNow.ToString('o')
    platform = 'Windows 10/11 x64'
    runtime = $runtimeVersion
    runtime_sha256 = $actualHash
    runtime_source = ($runtimeBase + 'win-x64/node.exe')
    runtime_checksums = ($runtimeBase + 'SHASUMS256.txt')
}
[System.IO.File]::WriteAllText((Join-Path $artifactOutput 'build-info.json'), ($buildInfo | ConvertTo-Json -Depth 5), $utf8)
$files = @(Get-ChildItem -LiteralPath $artifactOutput -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($artifactOutput.Length + 1).Replace('\', '/')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
[System.IO.File]::WriteAllText((Join-Path $artifactOutput 'package-manifest.json'), ($files | ConvertTo-Json -Depth 5), $utf8)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $top = Split-Path -Leaf $artifactOutput
    foreach ($file in (Get-ChildItem -LiteralPath $artifactOutput -Recurse -File)) {
        $relative = $file.FullName.Substring($artifactOutput.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, "$top/$relative", [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $zip.Dispose() }
$zipHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(($archivePath + '.sha256'), "$zipHash  $([System.IO.Path]::GetFileName($archivePath))`r`n", $utf8)
Write-Output "PACKAGE=$artifactOutput"
Write-Output "ZIP=$archivePath"
Write-Output "SHA256=$zipHash"
