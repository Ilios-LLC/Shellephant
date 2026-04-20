import Dockerode from 'dockerode'

let _docker: Dockerode | null = null

export function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}

const INTERNAL_NETWORKS = new Set(['bridge', 'host', 'none'])

export async function listBridgeNetworks(): Promise<{ id: string; name: string }[]> {
  const networks = await getDocker().listNetworks({ filters: { driver: ['bridge'] } })
  return (networks as { Id: string; Name: string }[])
    .filter(n => !INTERNAL_NETWORKS.has(n.Name))
    .map(n => ({ id: n.Id, name: n.Name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
