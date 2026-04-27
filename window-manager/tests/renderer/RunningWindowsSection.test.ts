import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RunningWindowsSection from '../../src/renderer/src/components/RunningWindowsSection.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'
import { waitingWindows } from '../../src/renderer/src/lib/waitingWindows'

function makeWindow(id: number, name: string, projectId: number, projectName: string, status: 'running' | 'stopped' = 'running'): WindowRecord {
  return {
    id,
    name,
    project_id: projectId,
    container_id: `container-${id}`,
    window_type: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    status,
    projects: [{ id, window_id: id, project_id: projectId, clone_path: '/tmp', project_name: projectName }]
  }
}

describe('RunningWindowsSection', () => {
  let onWindowSelect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onWindowSelect = vi.fn()
    waitingWindows._resetForTest()
  })

  afterEach(() => {
    cleanup()
    waitingWindows._resetForTest()
  })

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      allWindows: [] as WindowRecord[],
      onWindowSelect,
      ...overrides
    }
  }

  it('renders nothing when no running windows', () => {
    const { container } = render(RunningWindowsSection, baseProps())
    expect(container.querySelector('.running-section')).toBeNull()
  })

  it('renders nothing when all windows are stopped', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1', 'stopped')
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(container.querySelector('.running-section')).toBeNull()
  })

  it('renders running windows with project / window label', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText('proj1 / win1')).toBeDefined()
  })

  it('shows Running section header when running windows exist', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText(/running/i)).toBeDefined()
  })

  it('waiting window gets waiting class', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    waitingWindows.add({
      containerId: 'container-1',
      windowId: 1,
      windowName: 'win1',
      projectId: 1,
      projectName: 'proj1'
    })
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    const btn = container.querySelector('.running-item')
    expect(btn?.classList.contains('waiting')).toBe(true)
  })

  it('non-waiting running window does not get waiting class', () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    const { container } = render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    const btn = container.querySelector('.running-item')
    expect(btn?.classList.contains('waiting')).toBe(false)
  })

  it('clicking a waiting item calls onWindowSelect and removes from store', async () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    waitingWindows.add({
      containerId: 'container-1',
      windowId: 1,
      windowName: 'win1',
      projectId: 1,
      projectName: 'proj1'
    })
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    await fireEvent.click(screen.getByText('proj1 / win1'))
    expect(onWindowSelect).toHaveBeenCalledWith(w)
    let storeValue: typeof waitingWindows extends { subscribe: (fn: (v: infer V) => void) => void } ? V : never
    waitingWindows.subscribe((v) => { storeValue = v })()
    // @ts-ignore
    expect(storeValue.find((e) => e.containerId === 'container-1')).toBeUndefined()
  })

  it('clicking a non-waiting item calls onWindowSelect only', async () => {
    const w = makeWindow(1, 'win1', 1, 'proj1')
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    await fireEvent.click(screen.getByText('proj1 / win1'))
    expect(onWindowSelect).toHaveBeenCalledWith(w)
  })

  it('uses project name from win.projects when available', () => {
    const w: WindowRecord = {
      id: 2,
      name: 'mywin',
      project_id: null,
      container_id: 'container-2',
      window_type: 'manual',
      created_at: '2026-01-01T00:00:00Z',
      status: 'running',
      projects: [
        { id: 1, window_id: 2, project_id: 10, clone_path: '/tmp', project_name: 'alpha' },
        { id: 2, window_id: 2, project_id: 11, clone_path: '/tmp', project_name: 'beta' }
      ]
    }
    render(RunningWindowsSection, baseProps({ allWindows: [w] }))
    expect(screen.getByText('alpha, beta / mywin')).toBeDefined()
  })
})
