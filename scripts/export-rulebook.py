# Reads the rulebook workbook and writes it as JSON: {"Rules": [{header: value}], "Client corrections log": [...]}.
# Run by scripts/seed-rulebook.ts; usage: python -P export-rulebook.py <xlsx> <json>
import json, sys, openpyxl

wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
out = {}
for name in ("Rules", "Client corrections log"):
    rows = list(wb[name].iter_rows(values_only=True))
    head = rows[0]
    out[name] = [{h: (None if v is None else str(v).strip()) for h, v in zip(head, r)} for r in rows[1:] if r[0]]
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
