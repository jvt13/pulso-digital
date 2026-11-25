"""Conversão local opcional. Sem rede; Pillow deve estar instalado no operador."""
import os
import sys
from pathlib import Path
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 20_000_000
source = Path(sys.argv[1])
folder = Path(sys.argv[2])
if source.parent.resolve() != folder.resolve() or source.is_symlink() or not source.is_file():
    raise SystemExit(2)
with Image.open(source) as original:
    original.verify()
with Image.open(source) as original:
    image = ImageOps.exif_transpose(original).convert('RGB')
    width, height = image.size
    if width < 1600 or height < 900 or width * 9 != height * 16:
        raise SystemExit(3)
    for name, size, fmt, quality in [
        ('main.webp', (1600, 900), 'WEBP', 84),
        ('small.webp', (640, 360), 'WEBP', 78),
        ('share.jpg', (1600, 900), 'JPEG', 84),
    ]:
        target = folder / name
        if target.exists():
            continue
        output = image.resize(size, Image.Resampling.LANCZOS)
        temporary = folder / (name + '.tmp')
        try:
            output.save(temporary, format=fmt, quality=quality, optimize=True)
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()
