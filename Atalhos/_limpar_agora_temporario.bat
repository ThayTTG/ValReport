@echo off
REM Temporario: roda a limpeza do historico ja confirmada (aprovada pela Noky no chat) e se apaga no fim.
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "ferramentas\limpar_historico.ps1" -Confirmar LIMPAR
(goto) 2>nul & del "%~f0"
