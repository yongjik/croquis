# Utility function for creating PNG image data.
#
# Since we only generate exactly one kind of PNG, we take a number of shortcuts
# to make it easier for us.  (Alternatively, we could import something like
# Pillow, but it seems like overkill.)
#
# In particular, we always assume that the given data is 256x256x3, and the PNG
# "filtering" algorithm has been already applied: see RgbBuffer::make_png_data()
# for more explanation.

import struct
import zlib

# PNG image header, 256x256x3.
PNG_HEADER_RGB = (
    b'\x89\x50\x4e\x47\x0d\x0a\x1a\x0a'  # PNG file header
    b'\x00\x00\x00\x0d'  # IHDR chunk size
    b'\x49\x48\x44\x52'  # "IHDR"
    b'\x00\x00\x01\x00\x00\x00\x01\x00'  # width 256, height 256
    b'\x08\x02\x00\x00\x00'  # 8-bit RGB, no interlacing
    b'\xd3\x10\x3f\x31'  # CRC
)

# PNG image header, 256x256x4.
PNG_HEADER_RGBA = (
    b'\x89\x50\x4e\x47\x0d\x0a\x1a\x0a'  # PNG file header
    b'\x00\x00\x00\x0d'  # IHDR chunk size
    b'\x49\x48\x44\x52'  # "IHDR"
    b'\x00\x00\x01\x00\x00\x00\x01\x00'  # width 256, height 256
    b'\x08\x06\x00\x00\x00'  # 8-bit RGBA, no interlacing
    b'\x5c\x72\xa8\x66'  # CRC
)

PNG_FOOTER= b'\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82'

def generate_png(png_data, is_transparent):
    if is_transparent:
        header = PNG_HEADER_RGBA
        assert len(png_data) == 256 * (256 * 4 + 1)
    else:
        header = PNG_HEADER_RGB
        assert len(png_data) == 256 * (256 * 3 + 1)
    compressed = zlib.compress(png_data)
    crc = zlib.crc32(compressed, zlib.crc32(b'IDAT'))

    buf = bytearray(len(header) + len(compressed) + 12 + len(PNG_FOOTER))
    pos = 0

    def _append(data):
        nonlocal pos
        buf[pos:pos+len(data)] = data
        pos += len(data)

    _append(header)
    _append(struct.pack('>I', len(compressed)))
    _append(b'IDAT')
    _append(compressed)
    _append(struct.pack('>I', crc))
    _append(PNG_FOOTER)
    assert pos == len(buf)

    return buf
