import Dockerode from 'dockerode'

let _docker: Dockerode | null = null

export function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}

// Test-only helper so suites that re-init state can drop the cached instance.
export function __resetDockerForTests(): void {
  _docker = null
}
