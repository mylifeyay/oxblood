import { registerSW } from 'virtual:pwa-register'

/** How often a long-lived installed app re-checks for a new build. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000

interface Handlers {
  onUnsupported: () => void
  onCaching: () => void
  onReady: () => void
  onError: (error: Error) => void
}

/**
 * Registers the precache service worker and reports where it got to, so the
 * shell can say out loud whether the game will survive going offline.
 *
 * A precaching worker will happily serve last week's build forever if nothing
 * ever asks it to look for a new one. An installed home-screen app can sit in
 * the background for days without a fresh navigation, so this checks on every
 * return to the foreground, and hourly while it is open.
 */
export function registerServiceWorker(handlers: Handlers): void {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    handlers.onUnsupported()
    return
  }

  handlers.onCaching()

  // Only a worker replacing an existing one is an update worth reloading for;
  // the first install claims the page too, and reloading then is just a flash.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return
      const check = (): void => {
        void registration.update().catch(() => {
          // Offline, or the server is unreachable. Try again next time.
        })
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.setInterval(check, UPDATE_INTERVAL_MS)
    },
    onRegisterError(error: unknown) {
      handlers.onError(error instanceof Error ? error : new Error(String(error)))
    },
  })

  // `ready` resolves once an active worker controls this scope — the honest
  // signal that a cold, offline launch will now work.
  void navigator.serviceWorker.ready.then(() => handlers.onReady())
}
