import { openSheet } from './sheet.ts'

/** Free, uncapped, and not for sale. There is no money anywhere in this. */
export const CREDIT_AMOUNTS: readonly number[] = [500, 1000, 5000]

export function openAddCredit(onPick: (amount: number) => void): void {
  const sheet = openSheet('Add credit', (body) => {
    const choices = document.createElement('div')
    choices.className = 'choices'

    for (const amount of CREDIT_AMOUNTS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'choice'
      button.textContent = String(amount)
      button.addEventListener('click', () => {
        onPick(amount)
        sheet.close()
      })
      choices.append(button)
    }

    body.append(choices)
  })
}
