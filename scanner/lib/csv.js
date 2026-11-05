// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, embedded newlines).
// Calls onRow(object) for each data row so large files don't need an array of rows in memory.
export function parseCsv(text, onRow) {
  let i = 0;
  const n = text.length;
  let field = '';
  let row = [];
  let header = null;
  let inQuotes = false;
  let count = 0;

  const endRow = () => {
    row.push(field);
    field = '';
    if (!header) {
      header = row.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
    } else if (!(row.length === 1 && row[0] === '')) {
      const obj = {};
      for (let k = 0; k < header.length; k++) obj[header[k]] = row[k] ?? '';
      onRow(obj);
      count++;
    }
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();
  return { header: header || [], count };
}

export function parseCsvToArray(text) {
  const rows = [];
  parseCsv(text, (r) => rows.push(r));
  return rows;
}
