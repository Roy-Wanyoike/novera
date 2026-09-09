#!/usr/bin/env python3
"""Merge cover + body into the final QA report PDF (A4-normalized)."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

cover = PdfReader('/home/z/my-project/.tmp/qa/cover.pdf')
body = PdfReader('/home/z/my-project/.tmp/qa/body.pdf')

writer = PdfWriter()
writer.add_page(normalize_page_to_a4(cover.pages[0]))
for page in body.pages:
    writer.add_page(normalize_page_to_a4(page))

writer.add_metadata({
    '/Title': 'Novera Production Readiness Report',
    '/Author': 'Novera Engineering Organization',
    '/Creator': 'Z.ai',
    '/Subject': 'QA engineering audit — production readiness decision for the Novera TEST-mode reference build',
})

out = '/home/z/my-project/download/novera-production-readiness-report.pdf'
with open(out, 'wb') as f:
    writer.write(f)
print(f'wrote {out} with {len(writer.pages)} pages')
