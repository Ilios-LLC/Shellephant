import Swal from 'sweetalert2'

export type ToastLevel = 'success' | 'error' | 'info'

export interface ToastInput {
  level: ToastLevel
  title: string
  body?: string
}

const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  showCloseButton: true,
  timer: 3333,
  timerProgressBar: true,
  didOpen: (el) => {
    el.addEventListener('mouseenter', Swal.stopTimer)
    el.addEventListener('mouseleave', Swal.resumeTimer)
  }
})

export function pushToast(t: ToastInput): void {
  Toast.fire({
    icon: t.level,
    title: t.title,
    html: t.body ? `<pre style="margin:0.35rem 0 0;white-space:pre-wrap;word-break:break-word;font-family:var(--font-mono, monospace);font-size:0.75rem;text-align:left;">${escapeHtml(t.body)}</pre>` : undefined
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
