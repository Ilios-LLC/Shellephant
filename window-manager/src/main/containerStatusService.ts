import { getDocker } from './docker'

type ContainerStatus = 'running' | 'stopped' | 'unknown'

export async function getDepContainersStatus(
  containerIds: string[]
): Promise<Record<string, ContainerStatus>> {
  const entries = await Promise.all(
    containerIds.map(async (id) => {
      try {
        const info = await getDocker().getContainer(id).inspect()
        const status: ContainerStatus = info.State.Status === 'running' ? 'running' : 'stopped'
        return [id, status] as const
      } catch {
        return [id, 'unknown' as ContainerStatus] as const
      }
    })
  )
  return Object.fromEntries(entries)
}
