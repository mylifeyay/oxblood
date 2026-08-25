import type { Sound } from '../audio/sound.ts'

interface Page {
  readonly kind: 'title' | 'page'
  readonly title: string
  readonly lead?: string
  readonly body?: readonly string[]
  readonly next: string
}

/**
 * The way in.
 *
 * Four beats: the name, what the thing actually is, how to set it up, and then
 * the library — because a slot machine with nothing to give you is only half a
 * slot machine. Shown once, and afterwards from the menu.
 */
const PAGES: readonly Page[] = [
  {
    kind: 'title',
    title: 'Oxblood',
    lead: 'A slot machine that pays in your own video',
    next: 'Begin',
  },
  {
    kind: 'page',
    title: 'About this game',
    body: [
      'Oxblood is an exploration of how a slot machine holds on to you, and of how the same handful of tricks turn up in everything else built to keep you playing. Nothing in it is decoration. The near miss that was settled before the reels moved. The win that pays back less than the spin cost. The pot that climbs while you watch it. The room you have not earned yet. Each one is a real mechanism, tuned against maths that is written down and can be checked.',
      'Turn the sound on. Sound is doing more of the work here than the pictures are — the clack of each reel landing, the tone that rises when a scatter is one place short, the chime that arrives a beat before the credits catch up to it. Mute all that and the same odds stop feeling like anything at all. It is the cheapest trick in the building and the hardest one to notice.',
      'No money goes in and none comes out. The credits are free, and there is nothing to buy.',
    ],
    next: 'Next',
  },
  {
    kind: 'page',
    title: 'How to play',
    body: [
      'The prize is your own video. Import a few clips first, and mark each one Common, Rare or Legendary — that decides which size of win plays it back. Win a bonus and the machine cuts you a piece of one.',
      'Then spin. Three scatters pay a Mini, four a Minor, five a Major, and every one of them opens another segment of a clip. Collect enough segments and the whole video unlocks in your library, yours to watch back whenever you like.',
      'Run out of credit and tap Add credit. There is an unlimited supply and nothing riding on it.',
      'Keep playing and other cabinets will open up. What opens them is for you to find out.',
    ],
    next: 'Import videos',
  },
]

/**
 * `onFinish` runs when the last page's button is tapped — not when the intro is
 * skipped. Skipping means "let me at the machine", and dropping the file picker
 * on someone who just said that would be its own small betrayal.
 */
export function openIntro(sound: Sound, onFinish: () => void): void {
  let at = 0

  const root = document.createElement('div')
  root.className = 'intro'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-label', 'Welcome')

  const panel = document.createElement('div')
  panel.className = 'intro__panel'

  const content = document.createElement('div')
  content.className = 'intro__content'

  const dots = document.createElement('div')
  dots.className = 'intro__dots'

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'btn-line btn-line--primary intro__next'

  const skip = document.createElement('button')
  skip.type = 'button'
  skip.className = 'intro__skip'
  skip.textContent = 'Skip'

  const foot = document.createElement('div')
  foot.className = 'intro__foot'
  foot.append(dots, next, skip)

  panel.append(content, foot)
  root.append(panel)

  const close = (): void => {
    root.classList.remove('is-open')
    setTimeout(() => root.remove(), 260)
  }

  const render = (): void => {
    const page = PAGES[at]!
    content.className = `intro__content intro__content--${page.kind}`

    const heading = document.createElement('h1')
    heading.className = page.kind === 'title' ? 'intro__wordmark' : 'intro__title'
    heading.textContent = page.title

    const parts: HTMLElement[] = [heading]

    if (page.lead) {
      const rule = document.createElement('div')
      rule.className = 'intro__rule'
      const lead = document.createElement('p')
      lead.className = 'intro__lead'
      lead.textContent = page.lead
      parts.push(rule, lead)
    }

    for (const text of page.body ?? []) {
      const p = document.createElement('p')
      p.textContent = text
      parts.push(p)
    }

    content.replaceChildren(...parts)
    content.scrollTop = 0

    dots.replaceChildren(
      ...PAGES.map((_, i) => {
        const dot = document.createElement('span')
        dot.className = i === at ? 'intro__dot is-on' : 'intro__dot'
        return dot
      }),
    )

    next.textContent = page.next
    skip.hidden = at === PAGES.length - 1
  }

  next.addEventListener('click', () => {
    // iOS only grants audio during a gesture, and this is the first one the app
    // ever gets. Claiming it here means the very first reel already has a voice.
    sound.unlock()
    if (at < PAGES.length - 1) {
      at++
      render()
      return
    }
    close()
    onFinish()
  })

  skip.addEventListener('click', () => {
    sound.unlock()
    close()
  })

  render()
  document.body.append(root)
  void root.offsetHeight
  root.classList.add('is-open')
  next.focus()
}
