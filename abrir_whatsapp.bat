@echo off
chcp 65001 > nul
echo ========================================================
echo  Abrindo WhatsApp Web com a Sessão da Larissa...
echo ========================================================
echo.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="E:\aplicativos\Vendeo_site\services\whatsapp2-gateway\.session\session-vendeo-whatsapp2" --no-first-run --no-default-browser-check "https://web.whatsapp.com"
echo Janela do Chrome iniciada!
echo Quando terminar de apagar o status, feche a janela do Chrome.
timeout /t 5
