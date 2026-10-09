/**
 * Notification alert sound — uses the company bell .wav for every alert type.
 * Browsers require a user gesture before audio can play; unlock on first click.
 */

const SOUND_SRC = '/sounds/notification-bell.wav'
const STORAGE_KEY = 'hms.notifSound'

let audio: HTMLAudioElement | null = null
let unlocked = false
let lastPlayAt = 0

function getAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (!audio) {
    audio = new Audio(SOUND_SRC)
    audio.preload = 'auto'
    audio.volume = 0.75
  }
  return audio
}

/** Call once on first user gesture so browsers allow sound later. */
export function unlockNotificationSound() {
  const el = getAudio()
  if (!el) return
  // Play muted then reset — unlocks autoplay for later alerts
  const prevVol = el.volume
  el.volume = 0
  const p = el.play()
  if (p && typeof p.then === 'function') {
    void p
      .then(() => {
        el.pause()
        el.currentTime = 0
        el.volume = prevVol || 0.75
        unlocked = true
      })
      .catch(() => {
        el.volume = prevVol || 0.75
      })
  } else {
    el.volume = prevVol || 0.75
    unlocked = true
  }
}

/** Play the bell .wav when any notification arrives. */
export function playNotificationBell() {
  try {
    if (!isNotificationSoundEnabled()) return
    const now = Date.now()
    // Debounce rapid bursts (same ticket → multiple events)
    if (now - lastPlayAt < 600) return
    lastPlayAt = now

    const el = getAudio()
    if (!el) return
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      void p.catch(() => {
        // Autoplay blocked — wait for next user gesture unlock
        unlocked = false
      })
    }
    unlocked = true
  } catch {
    /* ignore autoplay / media errors */
  }
}

export function isNotificationSoundEnabled() {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setNotificationSoundEnabled(on: boolean) {
  localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  if (on) unlockNotificationSound()
}

export function isNotificationSoundUnlocked() {
  return unlocked
}
