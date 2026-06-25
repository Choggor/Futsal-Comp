import { useEffect, useState } from 'react'
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './PublicLayout.css'

interface Venue { id: string; name: string }

export function PublicLayout() {
  const [venues, setVenues] = useState<Venue[]>([])
  const { venueId } = useParams<{ venueId?: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('venues')
      .select('id, name')
      .order('name')
      .then(({ data }) => setVenues(data ?? []))
  }, [])

  function handleVenueChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (id) navigate(`/venue/${id}`)
    else navigate('/')
  }

  return (
    <div className="public">
      <header className="pub-header">
        <div className="pub-header__inner">
          <Link to="/" className="pub-logo">
            <img src="/logo.svg" alt="The Futsal Collective" height="44" />
          </Link>
          <nav className="pub-nav">
            <select
              className="pub-venue-select"
              value={venueId ?? ''}
              onChange={handleVenueChange}
            >
              <option value="">Select a venue…</option>
              {venues.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </nav>
        </div>
        <div className="pub-header__rule" />
      </header>

      <main className="pub-main">
        <Outlet />
      </main>

      <footer className="pub-footer">
        <div className="pub-footer__inner">
          <img src="/logo.svg" alt="The Futsal Collective" height="28" />
          <p>© {new Date().getFullYear()} The Futsal Collective</p>
        </div>
      </footer>
    </div>
  )
}
