"""Independent render/text/barcode check of the demonstration PDF (no ERP calls)."""
from pathlib import Path
import sys
import pypdfium2
from pypdf import PdfReader
from reportlab.graphics.barcode.code128 import _patterns

pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('outputs/labels/demonstracao-etiqueta-100x150.pdf')
reader = PdfReader(pdf_path)
page_index = int(sys.argv[2]) if len(sys.argv) > 2 else 0
page = reader.pages[page_index]
assert abs(float(page.mediabox.width) - 100 * 72 / 25.4) < .001
assert abs(float(page.mediabox.height) - 150 * 72 / 25.4) < .001
text = page.extract_text()
assert 'DANFE SIMPLIFICADA' in text
if len(sys.argv) == 1:
    assert 'SEM VALOR POSTAL' in text
key = ''.join(text.strip().splitlines()[-1].split())
assert len(key) == 44 and key.isdigit()
image = pypdfium2.PdfDocument(pdf_path)[page_index].render(scale=3).to_pil().convert('RGB')
image.save(pdf_path.with_name(pdf_path.stem + (f'-pagina-{page_index + 1}' if len(reader.pages) > 1 else '') + '.png'))
# Read the actual rendered bars, independently of the JavaScript barcode encoder.
y = round((150 - 13.5) * 72 / 25.4 * 3)
pixels = [sum(image.getpixel((x, y))) < 384 for x in range(image.width)]
first = pixels.index(True)
last = len(pixels) - 1 - pixels[::-1].index(True)
runs = []
current, length = True, 0
for pixel in pixels[first:last + 1]:
    if pixel == current:
        length += 1
    else:
        runs.append(length)
        current, length = pixel, 1
runs.append(length)
patterns = {code: [ord(letter.upper()) - ord('A') + 1 for letter in pattern] for code, pattern in _patterns.items()}
codes = []
while len(runs) > 7:
    chunk, runs = runs[:6], runs[6:]
    norm = [value * 11 / sum(chunk) for value in chunk]
    errors = {code: sum((a - b) ** 2 for a, b in zip(norm, pattern)) for code, pattern in patterns.items() if len(pattern) == 6}
    code = min(errors, key=errors.get)
    assert errors[code] < .6, (code, errors[code])
    codes.append(code)
assert len(runs) == 7
assert codes[0] == 105  # CODE128 subset C, numeric pairs.
assert (codes[0] + sum(i * code for i, code in enumerate(codes[1:-1], 1))) % 103 == codes[-1]
decoded = ''.join(f'{code:02d}' for code in codes[1:-1])
assert decoded == key, (decoded, key)
assert min(runs) / (3 * 72 / 25.4) > .2
print('Verified 100x150 mm, expected text, and rendered CODE128 key/checksum:', decoded)
