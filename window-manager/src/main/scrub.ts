export function scrubPat(text: string, pat: string | undefined | null): string {
  if (!pat) return text
  const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'g'), '***')
}
