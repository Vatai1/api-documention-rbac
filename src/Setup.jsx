import React, { useState } from 'react'
import { setupAdmin } from './api.js'

/* Экран первичной настройки: установка пароля администратора (первый вход) */
export default function Setup({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 8) return setError('Пароль должен быть не короче 8 символов')
    if (password !== confirm) return setError('Пароли не совпадают')
    setError(''); setLoading(true)
    try {
      await setupAdmin(password)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🔐</div>
        <h1>Первичная настройка</h1>
        <p className="sub">Установите пароль администратора</p>
        {error && <div className="error-box">{error}</div>}
        <input
          type="password" placeholder="Пароль (минимум 8 символов)" value={password}
          onChange={e => setPassword(e.target.value)} required autoFocus
        />
        <input
          type="password" placeholder="Повторите пароль" value={confirm}
          onChange={e => setConfirm(e.target.value)} required
        />
        <button type="submit" disabled={loading}>
          {loading ? '...' : 'Установить пароль'}
        </button>
        <p className="hint">Логин администратора: <b>admin</b></p>
      </form>
    </div>
  )
}
