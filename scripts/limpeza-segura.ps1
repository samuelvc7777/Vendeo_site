# Script de limpeza segura do projeto Vendeo
# Remove diretórios identificados como não utilizados pelo código ativo
# Total estimado liberado: ~5.7 GB

$ErrorActionPreference = "Continue"

Write-Host "=== INICIANDO LIMPEZA SEGURA ===" -ForegroundColor Cyan
Write-Host ""

# Função para verificar se diretório existe antes de remover
function Remove-SafeDirectory {
    param([string]$path, [string]$description)

    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1GB
        Write-Host "Removendo: $description ($([math]::Round($size, 2)) GB)" -ForegroundColor Yellow

        try {
            Remove-Item $path -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Sucesso: $path removido" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ Erro ao remover $path : $_" -ForegroundColor Red
        }
    } else {
        Write-Host "  ⊘ Ignorado: $path já não existe" -ForegroundColor Gray
    }
}

# 1. .firebase/ — Cache de deploy (4.1 GB)
Remove-SafeDirectory ".firebase" "Cache de deploy Firebase"

# 2. services/whatsapp2-gateway/ — Gateway legado (1.6 GB)
Remove-SafeDirectory "services\whatsapp2-gateway" "Gateway WhatsApp legado"

# Se o diretório services ficar vazio após remover whatsapp2-gateway, remove-o também
if (Test-Path "services") {
    $remaining = Get-ChildItem "services" -Force
    if ($remaining.Count -eq 0) {
        Remove-Item "services" -Force
        Write-Host "  ✓ Diretório services/ removido (vazio)" -ForegroundColor Green
    }
}

# 3. larissa_lora/ — Modelo LoRA experimental (259 MB)
Remove-SafeDirectory "larissa_lora" "Modelo LoRA experimental Larissa"

Write-Host ""
Write-Host "=== LIMPEZA CONCLUÍDA ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Espaço estimado liberado: ~5.7 GB" -ForegroundColor Green
Write-Host ""
Write-Host "Próximos passos recomendados:" -ForegroundColor Yellow
Write-Host "1. Execute 'git status' para ver as mudanças" -ForegroundColor White
Write-Host "2. Commit as alterações se desejar" -ForegroundColor White
Write-Host ""
Write-Host "Pressione Enter para sair..."
Read-Host