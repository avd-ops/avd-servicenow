# Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
Set-StrictMode -Version Latest

function ConvertTo-AvdSnowRedactedText {
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$InputText
    )

    if ([string]::IsNullOrEmpty($InputText)) {
        return ''
    }

    $zeroGuid = '00000000-0000-0000-0000-000000000000'
    $out = [regex]::Replace($InputText, '\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b', {
        param($m)
        if ($m.Value.ToLowerInvariant() -eq $zeroGuid) { return $zeroGuid }
        return '<redacted-guid>'
    })
    $out = [regex]::Replace($out, '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '<user-upn>')
    $out = [regex]::Replace($out, '\b(?:\d{1,3}\.){3}\d{1,3}\b', '<ip-redacted>')
    $out = [regex]::Replace($out, '\bvm-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9.-]+)?\b', '<host-1>')
    return $out
}

function Get-AvdSnowSyncEnvelope {
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$EstateSlug = 'contoso-prod',

        [Parameter()]
        [switch]$AllowEstateIdentifiers,

        [Parameter()]
        [string]$FixturesDirectory = (Join-Path $PSScriptRoot '..' 'tests' 'fixtures')
    )

    $coreScript = Join-Path $PSScriptRoot '..' 'site' 'portal' 'servicenow-core.js'
    $c11Path = Join-Path $FixturesDirectory 'c11-contoso.json'
    $c21Path = Join-Path $FixturesDirectory 'c21-contoso.json'
    $c24Path = Join-Path $FixturesDirectory 'c24-contoso.json'

    $allowFlag = if ($AllowEstateIdentifiers.IsPresent) { 'true' } else { 'false' }
    $nodeCode = @"
const fs = require('node:fs');
const core = require($(ConvertTo-Json $coreScript));
const c11 = JSON.parse(fs.readFileSync($(ConvertTo-Json $c11Path), 'utf8'));
const c21 = JSON.parse(fs.readFileSync($(ConvertTo-Json $c21Path), 'utf8'));
const c24 = JSON.parse(fs.readFileSync($(ConvertTo-Json $c24Path), 'utf8'));
const env = core.buildSyncEnvelope({
  estateSlug: $(ConvertTo-Json $EstateSlug),
  allowEstateIdentifiers: $allowFlag,
  c11,
  c21,
  c24
});
const check = core.validateSyncEnvelope(env);
if (!check.valid) {
  console.error(check.errors.join('; '));
  process.exit(1);
}
process.stdout.write(JSON.stringify(env, null, 2));
"@

    $jsonOut = & node -e $nodeCode
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to build or validate AVD ServiceNow sync envelope."
    }
    return ($jsonOut | ConvertFrom-Json -Depth 20)
}

Export-ModuleMember -Function @(
    'ConvertTo-AvdSnowRedactedText',
    'Get-AvdSnowSyncEnvelope'
)
