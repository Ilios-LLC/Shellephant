import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreateWindow from '../../src/renderer/src/components/CreateWindow.svelte'
import type { WindowRecord } from '../../src/renderer/src/types'

const mockRecord: WindowRecord = {
  id: 1,
  name: 'My Window',
  container_id: 'abc123',
  created_at: '2026-01-01T00:00:00Z',
  status: 'running',
}

describe('CreateWindow', () => {
  let mockCreateWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCreateWindow = vi.fn().mockResolvedValue(mockRecord)
    vi.stubGlobal('api', { createWindow: mockCreateWindow })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders a text input with placeholder and a create window button', () => {
    render(CreateWindow, { startExpanded: true })
    expect(screen.getByPlaceholderText('window name')).toBeDefined()
    expect(screen.getByRole('button', { name: /create window/i })).toBeDefined()
  })

  it('calls window.api.createWindow with the trimmed name on button click', async () => {
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText('window name')
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: '  My Window  ' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith('My Window')
    })
  })

  it('clears the input after successful creation', async () => {
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText('window name') as HTMLInputElement
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: 'My Window' } })
    await fireEvent.click(button)

    // After successful create, component collapses — input is gone.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('window name')).toBeNull()
    })
  })

  it('disables the button when input is empty', async () => {
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText('window name') as HTMLInputElement
    const button = screen.getByRole('button', { name: /create window/i }) as HTMLButtonElement

    expect(button.disabled).toBe(true)

    await fireEvent.input(input, { target: { value: 'hello' } })
    await tick()
    expect(button.disabled).toBe(false)

    await fireEvent.input(input, { target: { value: '' } })
    await tick()
    expect(button.disabled).toBe(true)
  })

  it('calls onCreated callback with the new window record', async () => {
    const onCreated = vi.fn()
    render(CreateWindow, { startExpanded: true, onCreated })
    const input = screen.getByPlaceholderText('window name')
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: 'My Window' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(mockRecord)
    })
  })

  it('shows an error message if the API call fails', async () => {
    mockCreateWindow.mockRejectedValue(new Error('Docker error'))
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText('window name')
    const button = screen.getByRole('button', { name: /create window/i })

    await fireEvent.input(input, { target: { value: 'Bad Window' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Docker error')).toBeDefined()
    })
  })

  it('starts collapsed by default and shows a + button', () => {
    render(CreateWindow, {})
    expect(screen.getByRole('button', { name: /new window/i })).toBeDefined()
  })

  it('clicking + expands to show the input', async () => {
    render(CreateWindow, {})
    await fireEvent.click(screen.getByRole('button', { name: /new window/i }))
    expect(screen.getByPlaceholderText(/window name/i)).toBeDefined()
  })

  it('pressing Escape collapses back to the + button', async () => {
    render(CreateWindow, { startExpanded: true })
    const input = screen.getByPlaceholderText(/window name/i)
    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /new window/i })).toBeDefined()
  })
})
