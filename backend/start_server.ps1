# Start the Brain Radiology FM Portal backend on Windows PowerShell
param(
    [int]$Port = 8000,
    [switch]$Mock
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\config.yaml")) {
    Copy-Item ".\config.example.yaml" ".\config.yaml"
    Write-Host "Created backend\config.yaml from config.example.yaml" -ForegroundColor Cyan
}

if ($Mock) {
    $env:PORTAL_MOCK = "1"
    Write-Host "Starting Brain Radiology FM Portal in 3D Phantom MOCK mode on http://127.0.0.1:$Port ..." -ForegroundColor Yellow
} else {
    Write-Host "Starting Brain Radiology FM Portal GPU server on http://127.0.0.1:$Port ..." -ForegroundColor Green
}

python -m uvicorn server:app --host 127.0.0.1 --port $Port
