param(
    [string]$BaseUrl = 'http://127.0.0.1:3001',
    [string]$Name = 'JSONPlaceholder todo'
)

$ErrorActionPreference = 'Stop'
$demoUri = [Uri]$BaseUrl
if ($demoUri.Scheme -ne 'http' -or $demoUri.Host -notin @('127.0.0.1', 'localhost') -or
    $demoUri.UserInfo -or $demoUri.Query -or $demoUri.Fragment -or $demoUri.AbsolutePath -ne '/') {
    throw 'The demo must use a local HTTP API base URL without credentials, paths, or query parameters.'
}
$BaseUrl = $BaseUrl.TrimEnd('/')
$localHeaders = @{ 'X-Watchtower-Local' = '1' }

$endpoint = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/endpoints" -Headers $localHeaders `
    -ContentType 'application/json' -Body (@{
        name = $Name
        url = 'https://jsonplaceholder.typicode.com/todos/1'
    } | ConvertTo-Json)

$first = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/endpoints/$($endpoint.id)/checks" `
    -Headers $localHeaders -ContentType 'application/json' -Body '{}'
if ($first.check.outcome -ne 'success') {
    throw "The real upstream check failed ($($first.check.outcome), $($first.check.errorCode)). Inspect its saved history."
}

# Explicit acceptance makes another real GET. It never silently accepts the first check.
$accepted = Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/endpoints/$($endpoint.id)/baseline" `
    -Headers $localHeaders -ContentType 'application/json' -Body (@{
        accept = $true
        expectedUpdatedAt = $endpoint.updatedAt
    } | ConvertTo-Json)

$checked = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/endpoints/$($endpoint.id)/checks" `
    -Headers $localHeaders -ContentType 'application/json' -Body '{}'
$history = Invoke-RestMethod -Uri "$BaseUrl/api/endpoints/$($endpoint.id)/checks?limit=10" -Headers $localHeaders

[ordered]@{
    endpointId = $endpoint.id
    baselineAccepted = ($null -ne $accepted.endpoint.baselineSchema)
    firstComparison = $first.comparison
    latestOutcome = $checked.check.outcome
    latestHttpStatus = $checked.check.httpStatus
    latestResponseTimeMs = $checked.check.responseTimeMs
    history = $history.checks
} | ConvertTo-Json -Depth 20
