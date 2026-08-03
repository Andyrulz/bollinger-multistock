param(
    [switch]$SkipTests,
    [switch]$SkipBollinger,
    [switch]$ForceActivePositions
)

Write-Warning 'The legacy destructive deployment has been replaced by the staged, fail-closed workflow.'
& (Join-Path $PSScriptRoot 'deploy-dual-app-safe.ps1') `
    -SkipTests:$SkipTests `
    -SkipBollinger:$SkipBollinger `
    -ForceActivePositions:$ForceActivePositions
exit $LASTEXITCODE
