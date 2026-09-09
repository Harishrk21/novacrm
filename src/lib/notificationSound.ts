/** Soft two-tone chime for in-app notifications (no external asset). */

let audioCtx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

/** Call once on first user gesture so browsers allow sound later. */
export function unlockNotificationSound() {
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  unlocked = true
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gainPeak: number,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** Play a short bell when a live notification arrives. */
export function playNotificationBell() {
  try {
    const muted = localStorage.getItem('hms.notifSound') === 'off'
    if (muted) return
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    tone(ctx, 880, t0, 0.14, 0.08)
    tone(ctx, 1320, t0 + 0.12, 0.22, 0.06)
    unlocked = true
  } catch {
    /* ignore autoplay / AudioContext errors */
  }
}

export function isNotificationSoundEnabled() {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem('hms.notifSound') !== 'off'
}

export function setNotificationSoundEnabled(on: boolean) {
  localStorage.setItem('hms.notifSound', on ? 'on' : 'off')
  if (on) unlockNotificationSound()
}

export function isNotificationSoundUnlocked() {
  return unlocked
}
