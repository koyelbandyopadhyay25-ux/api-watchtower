param(
    [string]$BaseUrl = 'http://127.0.0.1:3001',
    [string]$Name = 'Scheduled todo verification',
    [ValidateRange(10, 120)][int]$TimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
$demoUri = [Uri]$BaseUrl
if ($demoUri.Scheme -ne 'http' -or $demoUri.Host -notin @('127.0.0.1', 'localhost') -or
    $demoUri.UserInfo -or $demoUri.Query -or $demoUri.Fragment -or $demoUri.AbsolutePath -ne '/') {
    throw 'Use the local HTTP management API, without credentials or query parameters.'
}
$BaseUrl = $BaseUrl.TrimEnd('/')
$localHeaders = @{ 'X-Watchtower-Local' = '1' }
$endpoint = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/endpoints" -Headers $localHeaders `
    -ContentType 'application/json' -Body (@{ name = $Name; url = 'https://jsonplaceholder.typicode.com/todos/1' } | ConvertTo-Json)
$scheduleUrl = "$BaseUrl/api/endpoints/$($endpoint.id)/schedule"
$enabled = $false
try {
    Invoke-RestMethod -Method Put -Uri $scheduleUrl -Headers $localHeaders -ContentType 'application/json' `
        -Body (@{ enabled = $true; intervalMinutes = 5 } | ConvertTo-Json) | Out-Null
    $enabled = $true
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $run = $null
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $history = Invoke-RestMethod -Uri "$BaseUrl/api/endpoints/$($endpoint.id)/scheduled-checks?limit=1" -Headers $localHeaders
        if ($history.runs.Count -gt 0) { $run = $history.runs[0]; break }
        Start-Sleep -Milliseconds 500
    }
    if ($null -eq $run) { throw 'No scheduled check was stored before the deadline. Verify that the separately enabled worker is running.' }
    $saved = Invoke-RestMethod -Uri "$BaseUrl/api/endpoints/$($endpoint.id)" -Headers $localHeaders
    [ordered]@{
        endpointId = $endpoint.id
        scheduledFor = $run.scheduledFor
        check = $run.checkResult
        baselineStillMissing = ($null -eq $saved.baselineSchema)
    } | ConvertTo-Json -Depth 20
    if ($run.checkResult.outcome -ne 'success') {
        throw 'The real scheduled check was persisted as a failure or schema change. Review the printed actual result; no success was fabricated.'
    }
}
finally {
    # Disable only the endpoint this demonstration created. Keep its real history.
    if ($enabled) {
        $disabled = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                Invoke-RestMethod -Method Put -Uri $scheduleUrl -Headers $localHeaders -ContentType 'application/json' `
                    -Body (@{ enabled = $false; intervalMinutes = 5 } | ConvertTo-Json) | Out-Null
                $disabled = $true
                break
            }
            catch {
                if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 409) { throw }
                Start-Sleep -Milliseconds 500
            }
        }
        if (-not $disabled) { throw "The demo could not confirm disablement. Disable endpoint $($endpoint.id) through its schedule route before restarting workers." }
    }
}
