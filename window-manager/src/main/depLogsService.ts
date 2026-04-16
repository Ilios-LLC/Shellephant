import type Dockerode from 'dockerode'

interface LogStream {
  on(event: 'data', cb: (data: Buffer) => void): LogStream
  destroy(): void
}

const activeStreams = new Map<string, LogStream>()

export async function startDepLogs(
  containerId: string,
  container: Dockerode.Container,
  onData: (chunk: string) => void
): Promise<void> {
  stopDepLogs(containerId)

  const stream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true
  })) as unknown as LogStream

  stream.on('data', (chunk: Buffer) => onData(chunk.toString()))
  activeStreams.set(containerId, stream)
}

export function stopDepLogs(containerId: string): void {
  const stream = activeStreams.get(containerId)
  if (stream) {
    stream.destroy()
    activeStreams.delete(containerId)
  }
}

export function stopAllDepLogs(): void {
  for (const [id] of activeStreams) {
    stopDepLogs(id)
  }
}
