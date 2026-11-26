"""Gera uma ilustração editorial própria, determinística e sem conteúdo de terceiros."""
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

WIDTH = 1600
HEIGHT = 900

PALETTES = {
    "tecnologia": ((7, 12, 35), (26, 45, 94), (76, 224, 211), (82, 116, 255)),
    "ia": ((9, 12, 32), (62, 33, 109), (111, 79, 255), (239, 117, 217)),
    "games": ((8, 15, 30), (32, 44, 71), (93, 230, 222), (255, 139, 155)),
    "espaco": ((3, 8, 25), (39, 25, 72), (170, 194, 255), (252, 183, 120)),
    "tendencias": ((19, 10, 28), (69, 34, 78), (255, 171, 131), (225, 97, 142)),
}


def gradient(size, start, end):
    image = Image.new("RGB", size)
    pixels = image.load()
    for y in range(size[1]):
        ratio = y / max(1, size[1] - 1)
        row = tuple(round(start[i] * (1 - ratio) + end[i] * ratio) for i in range(3))
        for x in range(size[0]):
            pixels[x, y] = row
    return image


def main():
    if len(sys.argv) != 4:
        raise SystemExit(2)
    target = Path(sys.argv[1])
    category = sys.argv[2]
    seed = int(sys.argv[3]) & 0xFFFFFFFF
    if target.exists() or target.is_symlink() or not target.parent.is_dir():
        raise SystemExit(3)
    base, deep, accent, secondary = PALETTES.get(category, PALETTES["tendencias"])
    rng = random.Random(seed)
    image = gradient((WIDTH, HEIGHT), base, deep)
    draw = ImageDraw.Draw(image, "RGBA")

    for step in range(0, WIDTH + HEIGHT, 80):
        draw.line((step, 0, step - HEIGHT, HEIGHT), fill=(*accent, 18), width=2)
    for _ in range(90):
        x, y = rng.randrange(WIDTH), rng.randrange(HEIGHT)
        radius = rng.choice((1, 1, 2, 3))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(255, 255, 255, rng.randrange(45, 155)))

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow, "RGBA")
    glow_draw.ellipse((810, 100, 1500, 790), fill=(*accent, 55))
    image = Image.alpha_composite(image.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(80)))
    draw = ImageDraw.Draw(image, "RGBA")

    if category == "espaco":
        draw.ellipse((930, 120, 1470, 660), fill=(230, 226, 238, 235), outline=(255, 255, 255, 120), width=4)
        draw.ellipse((1010, 180, 1270, 300), fill=(156, 144, 174, 55))
        draw.ellipse((1110, 380, 1390, 540), fill=(104, 101, 134, 42))
        draw.arc((650, 180, 1580, 780), 145, 330, fill=(*accent, 220), width=7)
        draw.ellipse((500, 405, 590, 495), fill=(245, 242, 255, 245))
        draw.polygon(((535, 480), (505, 555), (535, 535), (560, 582), (568, 490)), fill=(255, 188, 119, 235))
    elif category == "ia":
        nodes = [(1240, 180), (1440, 390), (1150, 650), (910, 460), (1080, 310), (1330, 600)]
        for index, node in enumerate(nodes):
            for other in nodes[index + 1:]:
                draw.line((*node, *other), fill=(*accent, 95), width=3)
        for index, (x, y) in enumerate(nodes):
            radius = 38 if index % 2 else 54
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*secondary, 70), outline=(*accent, 230), width=5)
            draw.ellipse((x - 10, y - 10, x + 10, y + 10), fill=(245, 248, 255, 235))
    elif category == "games":
        draw.rounded_rectangle((900, 220, 1480, 700), radius=70, fill=(18, 25, 49, 235), outline=(*accent, 180), width=6)
        draw.rounded_rectangle((970, 300, 1410, 610), radius=34, fill=(*accent, 45), outline=(*secondary, 180), width=4)
        draw.line((1030, 470, 1350, 470), fill=(*accent, 210), width=8)
        draw.line((1190, 350, 1190, 600), fill=(*secondary, 170), width=8)
        for x, y in ((1030, 630), (1110, 650), (1280, 630), (1370, 610)):
            draw.ellipse((x - 19, y - 19, x + 19, y + 19), fill=(*accent, 170))
    elif category == "tecnologia":
        draw.rounded_rectangle((870, 190, 1480, 735), radius=42, fill=(8, 15, 34, 230), outline=(*accent, 180), width=6)
        for row in range(4):
            for col in range(5):
                x = 955 + col * 105
                y = 280 + row * 110
                draw.rounded_rectangle((x, y, x + 68, y + 68), radius=15, fill=(*secondary, 45 + row * 12), outline=(*accent, 160), width=3)
        draw.line((950, 730, 1400, 730), fill=(*accent, 220), width=14)
    else:
        for index in range(8):
            x = 870 + index * 82
            height = 180 + rng.randrange(280)
            bar_color = accent if index % 2 else secondary
            draw.rounded_rectangle((x, 720 - height, x + 54, 720), radius=14, fill=(*bar_color, 90), outline=(255, 255, 255, 40), width=2)
        draw.line((850, 720, 1510, 720), fill=(*accent, 180), width=7)

    draw.rounded_rectangle((90, 690, 650, 805), radius=28, fill=(5, 8, 24, 165), outline=(255, 255, 255, 35), width=2)
    for index in range(5):
        draw.rounded_rectangle((125 + index * 96, 735, 195 + index * 96, 755), radius=10, fill=(*accent, 140 + index * 18))
    image.convert("RGB").save(target, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
