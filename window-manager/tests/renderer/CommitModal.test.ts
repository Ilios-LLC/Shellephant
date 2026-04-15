import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CommitModal from '../../src/renderer/src/components/CommitModal.svelte'

describe('CommitModal', () => {
  it('disables Submit while the subject is empty', () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false } })
    const submit = screen.getByRole('button', { name: /commit/i })
    expect(submit).toBeDisabled()
  })

  it('enables Submit once a trimmed subject is present', async () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false } })
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement
    await fireEvent.input(subject, { target: { value: 'Hello' } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeEnabled()
  })

  it('keeps Submit disabled when subject is whitespace-only', async () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false } })
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement
    await fireEvent.input(subject, { target: { value: '    ' } })
    expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled()
  })

  it('calls onSubmit with trimmed subject + body', async () => {
    const onSubmit = vi.fn()
    render(CommitModal, { props: { onSubmit, onCancel: vi.fn(), busy: false } })
    await fireEvent.input(screen.getByLabelText(/subject/i), { target: { value: '  Fix bug  ' } })
    await fireEvent.input(screen.getByLabelText(/body/i), { target: { value: 'details' } })
    await fireEvent.click(screen.getByRole('button', { name: /commit/i }))
    expect(onSubmit).toHaveBeenCalledWith({ subject: 'Fix bug', body: 'details' })
  })

  it('passes empty string for body when body input is empty', async () => {
    const onSubmit = vi.fn()
    render(CommitModal, { props: { onSubmit, onCancel: vi.fn(), busy: false } })
    await fireEvent.input(screen.getByLabelText(/subject/i), { target: { value: 'subj' } })
    await fireEvent.click(screen.getByRole('button', { name: /commit/i }))
    expect(onSubmit).toHaveBeenCalledWith({ subject: 'subj', body: '' })
  })

  it('disables inputs and submit while busy', () => {
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: true } })
    expect(screen.getByLabelText(/subject/i)).toBeDisabled()
    expect(screen.getByLabelText(/body/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /commit/i })).toBeDisabled()
  })

  it('Cancel button invokes onCancel', async () => {
    const onCancel = vi.fn()
    render(CommitModal, { props: { onSubmit: vi.fn(), onCancel, busy: false } })
    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('pre-populates subject from initialSubject prop', () => {
    render(CommitModal, {
      props: { onSubmit: vi.fn(), onCancel: vi.fn(), busy: false, initialSubject: 'Add feature X' }
    })
    const subject = screen.getByLabelText(/subject/i) as HTMLInputElement
    expect(subject.value).toBe('Add feature X')
  })

  it('pre-populates body from initialBody prop', () => {
    render(CommitModal, {
      props: {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
        busy: false,
        initialSubject: 'x',
        initialBody: '- point one\n- point two'
      }
    })
    const body = screen.getByLabelText(/body/i) as HTMLTextAreaElement
    expect(body.value).toBe('- point one\n- point two')
  })
})
