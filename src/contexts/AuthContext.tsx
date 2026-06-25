import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AppUser {
  id: string
  role: 'super_admin' | 'sub_admin'
  display_name: string | null
}

interface AuthContextValue {
  session: Session | null
  appUser: AppUser | null
  venueScopes: string[]
  isLoading: boolean
  isSuperAdmin: boolean
  hasVenueScope: (venueId: string) => boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [venueScopes, setVenueScopes] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function loadAppUser(authUserId: string) {
    const { data: user } = await supabase
      .from('app_users')
      .select('id, role, display_name')
      .eq('auth_user_id', authUserId)
      .single()

    if (!user) { setAppUser(null); return }
    setAppUser(user as AppUser)

    if (user.role === 'sub_admin') {
      const { data: scopes } = await supabase
        .from('admin_venue_access')
        .select('venue_id')
        .eq('user_id', user.id)
      setVenueScopes(scopes?.map((s: { venue_id: string }) => s.venue_id) ?? [])
    } else {
      setVenueScopes([])
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        loadAppUser(session.user.id).finally(() => setIsLoading(false))
      } else {
        setIsLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        loadAppUser(session.user.id)
      } else {
        setAppUser(null)
        setVenueScopes([])
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const isSuperAdmin = appUser?.role === 'super_admin'
  const hasVenueScope = (venueId: string) => isSuperAdmin || venueScopes.includes(venueId)
  const signOut = () => supabase.auth.signOut().then(() => undefined)

  return (
    <AuthContext.Provider value={{ session, appUser, venueScopes, isLoading, isSuperAdmin, hasVenueScope, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
