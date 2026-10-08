# Excel templates

`default/` holds the built-in master template used by the Sketch → Excel tool
(`/`):

- `template.xlsx` — the client-supplied sample workbook. It is **never
  modified**; every export is generated from an in-memory copy.
- `config.json` — how sketch data maps into the workbook (sheet, header row,
  data rows, which column receives which field, the unit of the dimension
  columns, rounding, etc.). Edit this file, or use the admin screen at
  `/admin`, to change the mapping.

Templates uploaded from the admin screen are stored outside the repository in
`TEMPLATE_STORAGE_DIR` (default `./storage/templates`).
