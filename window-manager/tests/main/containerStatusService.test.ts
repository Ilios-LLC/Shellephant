import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetContainer = vi.fn()
vi.mock('../../src/main/docker', () => ({
  getDocker: () => ({ getContainer: mockGetContainer })
}))

import { getDepContainersStatus } from '../../src/main/containerStatusService'

function makeContainer(status: string) {
  return { inspect: vi.fn().mockResolvedValue({ State: { Status: status } }) }
}

describe('containerStatusService', () => {
  beforeEach(() => { mockGetContainer.mockReset() })

  it('returns running for a running container', async () => {
    mockGetContainer.mockReturnValue(makeContainer('running'))
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('running')
  })

  it('returns stopped for an exited container', async () => {
    mockGetContainer.mockReturnValue(makeContainer('exited'))
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('stopped')
  })

  it('returns unknown when inspect throws', async () => {
    mockGetContainer.mockReturnValue({
      inspect: vi.fn().mockRejectedValue(new Error('not found'))
    })
    const result = await getDepContainersStatus(['abc123'])
    expect(result['abc123']).toBe('unknown')
  })

  it('handles multiple container IDs in one call', async () => {
    mockGetContainer
      .mockReturnValueOnce(makeContainer('running'))
      .mockReturnValueOnce(makeContainer('exited'))
    const result = await getDepContainersStatus(['c1', 'c2'])
    expect(result['c1']).toBe('running')
    expect(result['c2']).toBe('stopped')
  })

  it('returns empty object for empty input', async () => {
    const result = await getDepContainersStatus([])
    expect(result).toEqual({})
  })
})
