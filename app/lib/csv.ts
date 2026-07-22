/** Minimal RFC 4180 CSV serialization — quotes any value containing a comma,
 * quote, or newline, doubling embedded quotes. No external dependency. */
function escapeCsvValue(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvValue).join(","), ...rows.map((row) => row.map(escapeCsvValue).join(","))];
  // Leading BOM so Excel opens UTF-8 (accented French text) without mangling it.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
