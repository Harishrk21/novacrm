/**
 * Side-effect module — import FIRST in main.tsx so a stale session is cleared
 * before the auth store rehydrates from localStorage.
 */
import { enforceSessionOnBoot } from './sessionPolicy'

enforceSessionOnBoot()
