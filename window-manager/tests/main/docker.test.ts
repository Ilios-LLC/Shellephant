import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockListNetworks = vi.fn()

vi.mock('dockerode', () => {
  return {
    default: class MockDockerode {
      listNetworks = mockListNetworks
    }
  }
})

import { listBridgeNetworks } from '../../src/main/docker'

describe('listBridgeNetworks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user bridge networks sorted by name', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'abc', Name: 'my-net', Driver: 'bridge' },
      { Id: 'mno', Name: 'alpha-net', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([
      { id: 'mno', name: 'alpha-net' },
      { id: 'abc', name: 'my-net' },
    ])
  })

  it('strips Docker internal networks (bridge, host, none)', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'a', Name: 'bridge', Driver: 'bridge' },
      { Id: 'b', Name: 'host', Driver: 'bridge' },
      { Id: 'c', Name: 'none', Driver: 'bridge' },
      { Id: 'd', Name: 'user-net', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([{ id: 'd', name: 'user-net' }])
  })

  it('returns empty array when no user bridge networks exist', async () => {
    mockListNetworks.mockResolvedValue([
      { Id: 'a', Name: 'bridge', Driver: 'bridge' },
    ])
    const result = await listBridgeNetworks()
    expect(result).toEqual([])
  })

  it('passes bridge driver filter to Docker', async () => {
    mockListNetworks.mockResolvedValue([])
    await listBridgeNetworks()
    expect(mockListNetworks).toHaveBeenCalledWith({ filters: { driver: ['bridge'] } })
  })
})
