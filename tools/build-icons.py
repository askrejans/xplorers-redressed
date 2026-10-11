#!/usr/bin/env python3
"""Render the original SVG app mark and package platform icons. Requires Pillow."""
# Copyright (C) 2026 Arvis Skrējāns. SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from PIL import Image, ImageColor, ImageDraw

PROJECT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT / "packaging"
SCALE = 4


def color(value):
    return None if value == "none" else ImageColor.getrgb(value)


def build():
    source = ET.parse(OUTPUT / "icon.svg").getroot()
    width, height = (int(source.get(name)) for name in ("width", "height"))
    image = Image.new("RGBA", (width * SCALE, height * SCALE))
    draw = ImageDraw.Draw(image)
    for element in source:
        kind = element.tag.rsplit("}", 1)[-1]
        if kind not in ("rect", "polygon"):
            continue
        fill = color(element.get("fill", "none"))
        stroke = color(element.get("stroke", "none"))
        stroke_width = round(float(element.get("stroke-width", "0")) * SCALE)
        if kind == "rect":
            x, y, w, h = (float(element.get(name)) * SCALE for name in ("x", "y", "width", "height"))
            draw.rounded_rectangle((x, y, x + w, y + h),
                                   radius=float(element.get("rx", "0")) * SCALE,
                                   fill=fill, outline=stroke, width=stroke_width)
        else:
            values = [float(value) * SCALE for value in re.findall(r"[-\d.]+", element.get("points"))]
            points = list(zip(values[::2], values[1::2]))
            if fill is not None:
                draw.polygon(points, fill=fill)
            if stroke is not None:
                draw.line(points + [points[0]], fill=stroke, width=stroke_width, joint="curve")
                if element.get("stroke-linejoin") == "round":
                    radius = stroke_width / 2
                    for x, y in points:
                        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=stroke)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    image.save(OUTPUT / "icon.png", optimize=True)
    image.save(OUTPUT / "icon.icns")
    image.save(OUTPUT / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    print("Built original SVG artwork as 1024px PNG, macOS ICNS and Windows ICO (16, 32, 48, 256px).")


if __name__ == "__main__":
    build()
