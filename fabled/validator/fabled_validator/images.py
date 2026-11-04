"""Read image dimensions from file headers only (PNG, JPEG, TGA). No image libraries needed."""
from __future__ import annotations

import struct
from typing import Optional, Tuple


def image_size(data: bytes) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    """Return (width, height, format) or (None, None, reason-ish format) when unknown."""
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        w, h = struct.unpack(">II", data[16:24])
        return w, h, "png"
    if len(data) >= 4 and data[:2] == b"\xff\xd8":
        return _jpeg_size(data)
    if len(data) >= 18 and data[2] in (1, 2, 3, 9, 10, 11) and data[1] in (0, 1):
        w, h = struct.unpack("<HH", data[12:16])
        if w and h and data[16] in (8, 15, 16, 24, 32):
            return w, h, "tga"
    return None, None, None


def _jpeg_size(data: bytes):
    i = 2
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > n:
            break
        seg_len = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if i + 9 <= n:
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h, "jpeg"
            break
        i += 2 + seg_len
    return None, None, "jpeg"


def image_size_from_path(path: str):
    with open(path, "rb") as fh:
        head = fh.read(1 << 16)
    w, h, fmt = image_size(head)
    if w is None and fmt == "jpeg":  # SOF can be after large EXIF blocks
        with open(path, "rb") as fh:
            w, h, fmt = image_size(fh.read())
    return w, h, fmt
