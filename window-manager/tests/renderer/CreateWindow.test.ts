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

  it('renders a text input with placeholder and a Create Window button', () => {
    render(CreateWindow)
    expect(screen.getByPlaceholderText('Window name')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Create Window' })).toBeDefined()
  })

  it('calls window.api.createWindow with the trimmed name on button click', async () => {
    render(CreateWindow)
    const input = screen.getByPlaceholderText('Window name')
    const button = screen.getByRole('button', { name: 'Create Window' })

    await fireEvent.input(input, { target: { value: '  My Window  ' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(mockCreateWindow).toHaveBeenCalledWith('My Window')
    })
  })

  it('clears the input after successful creation', async () => {
    render(CreateWindow)
    const input = screen.getByPlaceholderText('Window name') as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Create Window' })

    await fireEvent.input(input, { target: { value: 'My Window' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('disables the button when input is empty', async () => {
    render(CreateWindow)
    const input = screen.getByPlaceholderText('Window name') as HTMLInputElement
    const button = screen.getByRole('button', { name: 'Create Window' }) as HTMLButtonElement

    // Initially empty → disabled
    expect(button.disabled).toBe(true)

    // Type something → enabled
    await fireEvent.input(input, { target: { value: 'hello' } })
    await tick()
    expect(button.disabled).toBe(false)

    // Clear it → disabled again
    await fireEvent.input(input, { target: { value: '' } })
    await tick()
    expect(button.disabled).toBe(true)
  })

  it('calls onCreated callback with the new window record', async () => {
    const onCreated = vi.fn()
    render(CreateWindow, { props: { onCreated } })
    const input = screen.getByPlaceholderText('Window name')
    const button = screen.getByRole('button', { name: 'Create Window' })

    await fireEvent.input(input, { target: { value: 'My Window' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(mockRecord)
    })
  })

  it('shows an error message if the API call fails', async () => {
    mockCreateWindow.mockRejectedValue(new Error('Docker error'))
    render(CreateWindow)
    const input = screen.getByPlaceholderText('Window name')
    const button = screen.getByRole('button', { name: 'Create Window' })

    await fireEvent.input(input, { target: { value: 'Bad Window' } })
    await fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Docker error')).toBeDefined()
    })
  })
})
