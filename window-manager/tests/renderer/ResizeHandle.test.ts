import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte'
import ResizeHandle from '../../src/renderer/src/components/ResizeHandle.svelte'

afterEach(cleanup)

describe('ResizeHandle', () => {
  it('renders a separator element', () => {
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd: vi.fn() } })
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('calls onResize with positive delta on rightward pointer move', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerMove(el, { clientX: 110 })
    expect(onResize).toHaveBeenCalledWith(1) // (10/1000)*100
  })

  it('calls onResize with negative delta on leftward pointer move', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerMove(el, { clientX: 90 })
    expect(onResize).toHaveBeenCalledWith(-1) // (-10/1000)*100
  })

  it('does not call onResize before pointerdown', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    await fireEvent.pointerMove(screen.getByRole('separator'), { clientX: 200 })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('calls onResizeEnd on pointerup after drag', async () => {
    const onResizeEnd = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerUp(el)
    expect(onResizeEnd).toHaveBeenCalled()
  })

  it('does not call onResizeEnd on pointerup with no prior pointerdown', async () => {
    const onResizeEnd = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize: vi.fn(), onResizeEnd } })
    await fireEvent.pointerUp(screen.getByRole('separator'))
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('stops calling onResize after pointerup', async () => {
    const onResize = vi.fn()
    render(ResizeHandle, { props: { containerWidth: 1000, onResize, onResizeEnd: vi.fn() } })
    const el = screen.getByRole('separator')
    await fireEvent.pointerDown(el, { clientX: 100 })
    await fireEvent.pointerUp(el)
    onResize.mockClear()
    await fireEvent.pointerMove(el, { clientX: 200 })
    expect(onResize).not.toHaveBeenCalled()
  })
})
