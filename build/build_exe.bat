call .venv\Scripts\activate
pyinstaller --noconfirm --clean --onefile --windowed --name Nexora --collect-all pillow_heif --collect-all webview --collect-all pythonnet --hidden-import clr_loader --add-data "models;models" --add-data "nexora/web/static;nexora/web/static" --add-data "VERSION;." app.py
