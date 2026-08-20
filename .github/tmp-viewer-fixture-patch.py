from pathlib import Path

path = Path("tests/dicom-accession.behavior.test.mjs")
text = path.read_text()
old = 'const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com" };'
new = 'const PACS_ENV = { OUTBOUND_ALLOWED_HOSTS: "pacs.example.com,viewer.example.com" };'
if old not in text:
    raise SystemExit("PACS_ENV fixture not found")
path.write_text(text.replace(old, new, 1))
