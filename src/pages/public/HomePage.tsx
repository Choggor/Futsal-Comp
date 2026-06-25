import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import './HomePage.css'

interface Venue { id: string; name: string; address: string | null }

export function HomePage() {
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('venues')
      .select('id, name, address')
      .order('name')
      .then(({ data }) => {
        setVenues(data ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="home">
      {/* Hero */}
      <section className="home-hero">
        <div className="home-hero__inner">
          <span className="eyebrow">Indoor football · competitive &amp; social</span>
          <h1 className="home-hero__title">
            <span className="gradient-text">Play the game</span>
            <br />you love.
          </h1>
          <p className="home-hero__lead">
            The Futsal Collective runs weekly futsal competitions across multiple venues.
            Check your fixtures, track the ladder, and see who's taking out MVP.
          </p>
          <div className="home-hero__cta">
            <a href="mailto:info@futsalcollective.com.au" className="btn btn-primary">
              Register a team
            </a>
            <a href="#venues" className="btn btn-outline">
              Find your venue
            </a>
          </div>
        </div>
        <div className="home-hero__spectrum" aria-hidden="true" />
      </section>

      {/* Venues */}
      <section className="home-venues" id="venues">
        <div className="home-section__inner">
          <h2>Our venues</h2>
          <hr className="brand-rule" style={{ marginBottom: 'var(--space-6)' }} />
          {loading ? (
            <p style={{ color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{
                display: 'inline-block', width: 18, height: 18, borderRadius: '50%',
                border: '2px solid var(--color-line)', borderTopColor: 'var(--color-primary)',
                animation: 'spin 0.7s linear infinite', flexShrink: 0
              }} />
              Loading venues…
            </p>
          ) : venues.length === 0 ? (
            <p style={{ color: 'var(--color-muted)' }}>No venues listed yet.</p>
          ) : (
            <div className="venue-grid">
              {venues.map(v => (
                <Link key={v.id} to={`/venue/${v.id}`} className="venue-card card">
                  <div className="venue-card__accent" />
                  <h3 className="venue-card__name">{v.name}</h3>
                  {v.address && (
                    <p className="venue-card__address">{v.address}</p>
                  )}
                  <span className="venue-card__link">View fixtures &amp; ladder →</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
