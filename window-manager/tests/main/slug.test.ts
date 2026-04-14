import { describe, it, expect } from 'vitest'
import { toSlug } from '../../src/main/slug'

describe('toSlug', () => {
  it('lowercases and joins words with a dash', () => {
    expect(toSlug('My Feature')).toBe('my-feature')
  })

  it('trims leading and trailing whitespace and dashes', () => {
    expect(toSlug('  leading/trailing  ')).toBe('leading-trailing')
  })

  it('strips diacritics', () => {
    expect(toSlug('Café 123')).toBe('cafe-123')
  })

  it('collapses repeated separators', () => {
    expect(toSlug('multi---dash___word')).toBe('multi-dash-word')
  })

  it('drops every non-alphanumeric character except dashes', () => {
    expect(toSlug('Fix: bug #42!')).toBe('fix-bug-42')
  })

  it('throws if the slug ends up empty', () => {
    expect(() => toSlug('!!!')).toThrow(/empty slug/i)
    expect(() => toSlug('')).toThrow(/empty slug/i)
  })
})
