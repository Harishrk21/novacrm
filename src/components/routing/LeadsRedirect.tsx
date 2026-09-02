import { Navigate, useSearchParams } from 'react-router-dom'

/** Preserve query string when redirecting legacy /leads URLs to /sale-tracking */
export function LeadsRedirect() {
  const [params] = useSearchParams()
  const q = params.toString()
  return <Navigate to={q ? `/sale-tracking?${q}` : '/sale-tracking'} replace />
}
