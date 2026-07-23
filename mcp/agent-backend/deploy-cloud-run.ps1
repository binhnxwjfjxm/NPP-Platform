param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [string]$Region = "asia-southeast1",
  [string]$Service = "mcp-plan-report-agent",
  [string]$Model = "gemini-2.5-pro",
  [bool]$AllowUnauthenticated = $true
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptRoot

try {
  Write-Host "Project: $ProjectId"
  Write-Host "Region : $Region"
  Write-Host "Service: $Service"
  Write-Host "Model  : $Model"

  gcloud config set project $ProjectId | Out-Host
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com artifactregistry.googleapis.com | Out-Host

  $arguments = @(
    "run", "deploy", $Service,
    "--source", ".",
    "--project", $ProjectId,
    "--region", $Region,
    "--platform", "managed",
    "--set-env-vars", "GOOGLE_CLOUD_PROJECT=$ProjectId,GOOGLE_CLOUD_LOCATION=$Region,GOOGLE_GENAI_USE_VERTEXAI=true,MCP_REPORT_AGENT_MODEL=$Model",
    "--quiet"
  )

  if ($AllowUnauthenticated) {
    $arguments += "--allow-unauthenticated"
  }

  & gcloud @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Cloud Run deploy failed with exit code $LASTEXITCODE"
  }

  $serviceUrl = gcloud run services describe $Service `
    --project $ProjectId `
    --region $Region `
    --format "value(status.url)"

  if (-not $serviceUrl) {
    throw "Deploy completed but Cloud Run service URL was not returned."
  }

  Write-Host ""
  Write-Host "Health : $serviceUrl/health"
  Write-Host "Analyze: $serviceUrl/analyze"
  Write-Host ""
  Write-Host "Set MCP_REPORT_AGENT_URL=$serviceUrl/analyze in the MCP-Plan server environment."
}
finally {
  Pop-Location
}
