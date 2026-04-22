/**
 * Parse a .env file string into a key-value record.
 *
 * Supported syntax:
 *   KEY=value
 *   KEY="double quoted"
 *   KEY='single quoted'
 *   # comment lines (skipped)
 *   export KEY=value  (export prefix stripped)
 *   Empty lines skipped
 */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // Strip optional "export " prefix
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line
    const eqIdx = stripped.indexOf('=')
    if (eqIdx < 1) continue
    const key = stripped.slice(0, eqIdx).trim()
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    const raw = stripped.slice(eqIdx + 1)
    result[key] = unquote(raw)
  }
  return result
}

/** Strip surrounding single or double quotes and unescape internals. */
function unquote(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1)
  }
  // Unquoted: strip inline comment only when preceded by whitespace
  const commentIdx = raw.search(/\s+#/)
  return (commentIdx >= 0 ? raw.slice(0, commentIdx) : raw).trim()
}

/**
 * Serialize a key-value record to .env file format.
 * Values needing quotes (spaces, special chars, empty) are double-quoted.
 */
export function serializeEnvFile(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([key, value]) => {
    return `${key}=${quoteValue(value)}`
  })
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

function quoteValue(value: string): string {
  if (value === '') return '""'
  // Quote if contains whitespace, #, quotes, backslash, or control chars
  if (/[\s#"'\\`$]/.test(value) || /[\x00-\x1f]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }
  return value
}
