import React, { useState } from 'react'
import { login } from './api.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(username, password)
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🗺️</div>
        <h1>API Портал</h1>
        <p className="sub">Авторизация для доступа к API</p>
        {error && <div className="error-box">{error}</div>}
        <input
          type="text" placeholder="Логин" value={username}
          onChange={e => setUsername(e.target.value)} required autoFocus
        />
        <input
          type="password" placeholder="Пароль" value={password}
          onChange={e => setPassword(e.target.value)} required
        />
        <button type="submit" disabled={loading}>
          {loading ? '...' : 'Войти'}
        </button>
        <p className="hint">Демо: <b>admin</b> / <b>admin12345</b></p>
      </form>
    </div>
  )
}
