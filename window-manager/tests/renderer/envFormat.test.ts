import { describe, expect, it } from 'vitest'
import { parseEnvFile, serializeEnvFile } from '../../src/renderer/src/lib/envFormat'

describe('parseEnvFile', () => {
  it('parses simple key=value pairs', () => {
    expect(parseEnvFile('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips comment lines', () => {
    expect(parseEnvFile('# comment\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('skips empty lines', () => {
    expect(parseEnvFile('\n\nFOO=bar\n\n')).toEqual({ FOO: 'bar' })
  })

  it('strips double quotes from values', () => {
    expect(parseEnvFile('FOO="hello world"')).toEqual({ FOO: 'hello world' })
  })

  it('strips single quotes from values', () => {
    expect(parseEnvFile("FOO='hello world'")).toEqual({ FOO: 'hello world' })
  })

  it('handles empty value', () => {
    expect(parseEnvFile('FOO=')).toEqual({ FOO: '' })
  })

  it('handles empty double-quoted value', () => {
    expect(parseEnvFile('FOO=""')).toEqual({ FOO: '' })
  })

  it('strips export prefix', () => {
    expect(parseEnvFile('export FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('unescapes \\n in double-quoted values', () => {
    expect(parseEnvFile('FOO="line1\\nline2"')).toEqual({ FOO: 'line1\nline2' })
  })

  it('unescapes \\" in double-quoted values', () => {
    expect(parseEnvFile('FOO="say \\"hi\\""')).toEqual({ FOO: 'say "hi"' })
  })

  it('strips inline comment from unquoted value', () => {
    expect(parseEnvFile('FOO=bar # comment')).toEqual({ FOO: 'bar' })
  })

  it('does not strip inline comment from quoted value', () => {
    expect(parseEnvFile('FOO="bar # not a comment"')).toEqual({ FOO: 'bar # not a comment' })
  })

  it('ignores lines without = sign', () => {
    expect(parseEnvFile('NOEQUALS\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('ignores keys failing identifier pattern', () => {
    expect(parseEnvFile('123BAD=val\nGOOD=ok')).toEqual({ GOOD: 'ok' })
  })

  it('handles CRLF line endings', () => {
    expect(parseEnvFile('FOO=bar\r\nBAZ=qux\r\n')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('last definition wins for duplicate keys', () => {
    expect(parseEnvFile('FOO=first\nFOO=second')).toEqual({ FOO: 'second' })
  })
})

describe('serializeEnvFile', () => {
  it('serializes simple key-value pairs', () => {
    expect(serializeEnvFile({ FOO: 'bar' })).toBe('FOO=bar\n')
  })

  it('quotes values containing spaces', () => {
    expect(serializeEnvFile({ FOO: 'hello world' })).toBe('FOO="hello world"\n')
  })

  it('quotes empty values', () => {
    expect(serializeEnvFile({ FOO: '' })).toBe('FOO=""\n')
  })

  it('quotes values containing #', () => {
    expect(serializeEnvFile({ FOO: 'bar#baz' })).toBe('FOO="bar#baz"\n')
  })

  it('escapes double quotes inside quoted values', () => {
    expect(serializeEnvFile({ FOO: 'say "hi"' })).toBe('FOO="say \\"hi\\""\n')
  })

  it('escapes newlines inside quoted values', () => {
    expect(serializeEnvFile({ FOO: 'line1\nline2' })).toBe('FOO="line1\\nline2"\n')
  })

  it('returns empty string for empty record', () => {
    expect(serializeEnvFile({})).toBe('')
  })

  it('serializes multiple pairs as separate lines', () => {
    const result = serializeEnvFile({ A: '1', B: '2' })
    expect(result).toBe('A=1\nB=2\n')
  })

  it('round-trips through parseEnvFile', () => {
    const original = { FOO: 'bar', GREETING: 'hello world', EMPTY: '', QUOTED: 'say "hi"' }
    const serialized = serializeEnvFile(original)
    const parsed = parseEnvFile(serialized)
    expect(parsed).toEqual(original)
  })
})
