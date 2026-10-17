import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useUIStore } from '@/store/uiStore'

/** `/team-chat` has no full-page UI — team chat lives in the footer dock. */
export function TeamChatOpenPage() {
  const openTeamChat = useUIStore((s) => s.openTeamChat)

  useEffect(() => {
    openTeamChat('chats')
  }, [openTeamChat])

  return <Navigate to="/" replace />
}

export default TeamChatOpenPage
