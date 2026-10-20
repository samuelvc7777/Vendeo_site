# Script de limpeza segura do projeto Vendeo
# Remove diretorios identificados como nao utilizados pelo codigo ativo
# Total estimado liberado: ~5.7 GB

$ErrorActionPreference = "Continue"

Write-Host "=== INICIANDO LIMPEZA SEGURA ===" -ForegroundColor Cyan
Write-Host ""

function Remove-SafeDirectory {
    param([string]$path, [string]$description)

    if (Test-Path $path) {
        $sizeBytes = (Get-ChildItem $path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sizeGB = [math]::Round($sizeBytes / 1GB, 2)
        Write-Host "Removendo: $description ($sizeGB GB)" -ForegroundColor Yellow
        try {
            Remove-Item $path -Recurse -Force -ErrorAction Stop
            Write-Host " OK: $path removido" -ForegroundColor Green
        } catch {
            Write-Host " ERRO ao remover $path : $_" -ForegroundColor Red
        }
    } else {
        Write-Host " Ignorado: $path ja nao existe" -ForegroundColor Gray
    }
}

# 1. .firebase/ - Cache de deploy (4.1 GB)
Remove-SafeDirectory ".firebase" "Cache de deploy Firebase"

# 2. services/whatsapp2-gateway/ - Gateway legado (1.6 GB)
Remove-SafeDirectory "services\whatsapp2-gateway" "Gateway WhatsApp legado"

# Se o diretorio services ficar vazio, remove-lo tambem
if (Test-Path "services") {
    $remaining = Get-ChildItem "services" -Force -ErrorAction SilentlyContinue
    if ($null -eq $remaining -or $remaining.Count -eq 0) {
        Remove-Item "services" -Force -ErrorAction SilentlyContinue
        Write-Host " OK: Diretorio services/ removido (vazio)" -ForegroundColor Green
    }
}

# 3. larissa_lora/ - Modelo LoRA experimental (259 MB)
Remove-SafeDirectory "larissa_lora" "Modelo LoRA experimental Larissa"

Write-Host ""
Write-Host "=== LIMPEZA CONCLUIDA ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Espaco estimado liberado: ~5.7 GB" -ForegroundColor Green
Write-Host ""