import './styles/index.css'
import { registerServiceWorker } from './pwa.ts'
import { startGame } from './ui/app.ts'

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone
}

function isIos(): boolean {
  // iPadOS reports as Mac, so check for touch as well.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))
}

function main(): void {
  const status = document.getElementById('status')
  const hint = document.getElementById('hint')

  const setStatus = (text: string, tone: 'plain' | 'ready' | 'warn' = 'plain'): void => {
    if (!status) return
    status.textContent = text
    status.classList.toggle('status--ready', tone === 'ready')
    status.classList.toggle('status--warn', tone === 'warn')
  }

  registerServiceWorker({
    onUnsupported: () => setStatus('Offline mode needs HTTPS. Serve this over https and reload.', 'warn'),
    onCaching: () => setStatus('Caching for offline use'),
    onReady: () => setStatus('Ready to play offline', 'ready'),
    onError: (error) => setStatus(`Offline caching failed: ${error.message}`, 'warn'),
  })

  if (hint) {
    hint.textContent = isStandalone() || !isIos() ? '' : 'Tap share, then Add to Home Screen, to install it.'
  }

  void startGame()
}

main()
