import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db'
import { createGroup, listGroups } from '../../src/main/projectGroupService'

describe('projectGroupService', () => {
  beforeEach(() => {
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  describe('createGroup', () => {
    it('creates a group and returns it', () => {
      const result = createGroup('frontend')
      expect(result.name).toBe('frontend')
      expect(result.id).toBeTypeOf('number')
      expect(result.created_at).toBeTypeOf('string')
    })

    it('trims whitespace from name', () => {
      const result = createGroup('  backend  ')
      expect(result.name).toBe('backend')
    })

    it('creates multiple groups with distinct ids', () => {
      const a = createGroup('alpha')
      const b = createGroup('beta')
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('listGroups', () => {
    it('returns empty array when no groups exist', () => {
      expect(listGroups()).toEqual([])
    })

    it('returns all created groups', () => {
      createGroup('alpha')
      createGroup('beta')
      const groups = listGroups()
      expect(groups).toHaveLength(2)
      expect(groups.map((g) => g.name)).toContain('alpha')
      expect(groups.map((g) => g.name)).toContain('beta')
    })

    it('returns groups ordered by created_at ascending', () => {
      createGroup('first')
      createGroup('second')
      const groups = listGroups()
      expect(groups[0].name).toBe('first')
      expect(groups[1].name).toBe('second')
    })
  })
})
