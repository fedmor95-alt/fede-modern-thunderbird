@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>&1
if not errorlevel 1 (
    py -3 install_windows.py
    goto done
)
python -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>&1
if not errorlevel 1 (
    python install_windows.py
    goto done
)
echo Python 3.9 o successivo non rilevato. Nessuna modifica eseguita.
echo Verificare le installazioni Python esistenti prima di aggiungerne una.
:done
pause
