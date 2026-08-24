/**
 * A modal panel. One at a time, dismissed by the close button, the backdrop,
 * or Escape. The body scrolls on its own so the cabinet behind it never does.
 */

export interface Sheet {
  readonly body: HTMLElement
  close(): void
}

let open: Sheet | null = null

export function openSheet(title: string, fill: (body: HTMLElement) => void, onClose?: () => void): Sheet {
  open?.close()

  const root = document.createElement('div')
  root.className = 'sheet'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', title)

  const panel = document.createElement('div')
  panel.className = 'sheet__panel'

  const head = document.createElement('header')
  head.className = 'sheet__head'

  const heading = document.createElement('h2')
  heading.className = 'sheet__title'
  heading.textContent = title

  const close = document.createElement('button')
  close.className = 'sheet__close'
  close.type = 'button'
  close.textContent = 'Close'

  const body = document.createElement('div')
  body.className = 'sheet__body'

  head.append(heading, close)
  panel.append(head, body)
  root.append(panel)

  const sheet: Sheet = {
    body,
    close() {
      if (open !== sheet) return
      open = null
      document.removeEventListener('keydown', onKey)
      root.remove()
      onClose?.()
    },
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') sheet.close()
  }

  close.addEventListener('click', () => sheet.close())
  root.addEventListener('click', (event) => {
    if (event.target === root) sheet.close()
  })
  document.addEventListener('keydown', onKey)

  fill(body)
  document.body.append(root)
  open = sheet
  return sheet
}
