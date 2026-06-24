import { useAuth } from '../../contexts/AuthContext'

export function Dashboard() {
  const { appUser, isSuperAdmin, venueScopes } = useAuth()

  return (
    <div>
      <h1>Dashboard</h1>
      <p style={{ marginTop: '0.5rem', color: 'var(--color-muted)' }}>
        Welcome back, {appUser?.display_name ?? 'Admin'}.{' '}
        {isSuperAdmin
          ? 'You have full super-admin access.'
          : `You are a venue admin with access to ${venueScopes.length} venue${venueScopes.length !== 1 ? 's' : ''}.`}
      </p>
    </div>
  )
}
