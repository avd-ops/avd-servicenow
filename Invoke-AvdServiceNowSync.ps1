#requires -Version 7.2
<#
.SYNOPSIS
    Builds, validates, and optionally syncs a redacted AVD ServiceNow ITSM & CMDB envelope (avd-itsm-sync-envelope/v1).
.DESCRIPTION
    Transforms C11 (facts), C21 (assessment report), and C24 (remediation plan) contracts into
    ServiceNow CMDB IRE batches, deduplicated Problem records, and phased Change Requests.
    Modes:
      - OfflineFixture ($0, writes envelope JSON to disk)
      - WhatIf ($0, dry-run envelope preview)
      - MockPdi ($0, runs end-to-end against the built-in local Mock-PDI REST server)
      - LivePdi ($0 against a free ServiceNow PDI; reads SNOW_INSTANCE_URL and SNOW_OAUTH_TOKEN or SNOW_USERNAME/SNOW_PASSWORD from environment)
    Personal project, not for production, provided as is; not affiliated with the author's employer,
    ServiceNow, Liquidware or Microsoft.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter()]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$EstateSlug = 'contoso-prod',

    [Parameter()]
    [ValidateSet('OfflineFixture', 'WhatIf', 'MockPdi', 'LivePdi')]
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

if (-not (Test-Path -LiteralPath $OutputPath -PathType Container)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}
$outFile = Join-Path $OutputPath "avd-itsm-sync-$EstateSlug.json"
$envelope | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $outFile -Encoding utf8NoBOM

if ($Mode -eq 'LivePdi') {
    $pdiClient = Join-Path $PSScriptRoot 'scripts' 'pdi-client.mjs'
    $syncOut = & node $pdiClient $outFile
    if ($LASTEXITCODE -ne 0) {
        throw "LivePdi sync failed."
    }
    return ($syncOut | ConvertFrom-Json -Depth 10)
}

if ($Mode -eq 'MockPdi') {
    $mockRunner = @"
import fs from 'node:fs';
import { createMockPdiServer } from './scripts/mock-pdi-server.mjs';
import { pushSyncEnvelopeToPdi } from './scripts/pdi-client.mjs';

const env = JSON.parse(fs.readFileSync($(ConvertTo-Json $outFile), 'utf8'));
const { server } = createMockPdiServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
try {
  const res = await pushSyncEnvelopeToPdi(env, {
    instanceUrl: 'http://127.0.0.1:' + port,
    authHeader: 'Bearer mock-token'
  });
  process.stdout.write(JSON.stringify(res, null, 2));
} finally {
  server.close();
}
"@
    $syncOut = & node --input-type=module -e $mockRunner
    if ($LASTEXITCODE -ne 0) {
        throw "MockPdi sync failed."
    }
    return ($syncOut | ConvertFrom-Json -Depth 10)
}

return $envelope
