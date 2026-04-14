import Dockerode from 'dockerode'

let _docker: Dockerode | null = null

export function getDocker(): Dockerode {
  if (!_docker) _docker = new Dockerode()
  return _docker
}
