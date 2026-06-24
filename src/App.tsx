import { Routes, Route, Link } from 'react-router-dom'

function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Futsal Competition</h1>
      <p>Coming soon — fixtures, standings and draw.</p>
      <nav>
        <Link to="/admin">Admin login</Link>
      </nav>
    </main>
  )
}

function Admin() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Admin</h1>
      <p>Auth to be wired in Phase 2.</p>
      <Link to="/">← Back</Link>
    </main>
  )
}

function NotFound() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>404 — Page not found</h1>
      <Link to="/">← Home</Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
