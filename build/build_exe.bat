call .venv\Scripts\activate
pyinstaller --noconfirm --clean --onefile --windowed --name Nexora --collect-all pillow_heif app.py
