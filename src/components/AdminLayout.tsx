import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function AdminLayout() {
  const { appUser, isSuperAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  function closeMenu() { setMenuOpen(false) }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <nav className="admin-nav">
          <span className="admin-nav-brand">Futsal Admin</span>
          <div className="admin-nav-links">
            <NavLink to="/admin/dashboard">Dashboard</NavLink>
            {isSuperAdmin && <NavLink to="/admin/venues">Venues</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/players">Players</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/players/import">Import CSV</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/setup">Setup Import</NavLink>}
            <NavLink to="/admin/draw">Draw</NavLink>
            {isSuperAdmin && <NavLink to="/admin/users">Users</NavLink>}
          </div>
          <div className="admin-nav-user">
            <span>{appUser?.display_name ?? 'Admin'}</span>
            <button onClick={handleSignOut}>Sign out</button>
          </div>
          <button
            className="admin-nav-hamburger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </nav>
        {menuOpen && (
          <div className="admin-nav-drawer">
            <NavLink to="/admin/dashboard" onClick={closeMenu}>Dashboard</NavLink>
            {isSuperAdmin && <NavLink to="/admin/venues" onClick={closeMenu}>Venues</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/players" onClick={closeMenu}>Players</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/players/import" onClick={closeMenu}>Import CSV</NavLink>}
            {isSuperAdmin && <NavLink to="/admin/setup" onClick={closeMenu}>Setup Import</NavLink>}
            <NavLink to="/admin/draw" onClick={closeMenu}>Draw</NavLink>
            {isSuperAdmin && <NavLink to="/admin/users" onClick={closeMenu}>Users</NavLink>}
            <div className="admin-nav-drawer-user">
              <span>{appUser?.display_name ?? 'Admin'}</span>
              <button onClick={handleSignOut}>Sign out</button>
            </div>
          </div>
        )}
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
