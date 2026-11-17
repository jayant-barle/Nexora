call .venv\Scripts\activate
pyinstaller --noconfirm --clean --onefile --windowed --name Nexora --collect-all pillow_heif --add-data "models;models" app.py
