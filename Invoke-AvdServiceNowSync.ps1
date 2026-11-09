#requires -Version 7.2
<#
.SYNOPSIS
    Builds and validates a redacted AVD ServiceNow ITSM & CMDB sync envelope (avd-itsm-sync-envelope/v1).
.DESCRIPTION
    Transforms C11 (facts), C21 (assessment report), and C24 (remediation plan) contracts into
    ServiceNow CMDB IRE batches, deduplicated Problem records, and phased Change Requests.
    Personal project, not for production, provided as is; not affiliated with the author's employer,
    ServiceNow, Liquidware or Microsoft.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$EstateSlug = 'contoso-prod',

    [Parameter()]
    [ValidateSet('OfflineFixture', 'WhatIf')]
    [string]$Mode = 'OfflineFixture',

    [Parameter()]
    [switch]$AllowEstateIdentifiers,

    [Parameter()]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modulePath = Join-Path $PSScriptRoot 'scripts' 'AvdServiceNow.psm1'
Import-Module $modulePath -Force

$envelope = Get-AvdSnowSyncEnvelope -EstateSlug $EstateSlug -AllowEstateIdentifiers:$AllowEstateIdentifiers

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot 'out'
}

if ($Mode -eq 'OfflineFixture' -and $PSCmdlet.ShouldProcess($OutputPath, "Write C26 candidate sync envelope for $EstateSlug")) {
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Container)) {
        New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    }
    $outFile = Join-Path $OutputPath "avd-itsm-sync-$EstateSlug.json"
    $envelope | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outFile -Encoding utf8NoBOM
}

return $envelope
