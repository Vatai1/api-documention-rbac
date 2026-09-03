import React, { useState, useEffect } from 'react'
import { tryRequest, saveEndpointNote } from './api.js'
import { toast } from './toast.js'

const METHOD_CLASS = {
  GET: 'm-get', POST: 'm-post', PUT: 'm-put',
  DELETE: 'm-delete', PATCH: 'm-patch'
}

function respClass(code) {
  if (code < 300) return 'rc-2'
  if (code < 500) return 'rc-4'
  return 'rc-5'
}

function b64(s) {
  return btoa(unescape(encodeURIComponent(s)))
}

export default function EndpointDetail({ ep, api, isFav, onToggleFav, isAdmin }) {
  const params = ep.parameters || []
  const responses = ep.responses || {}
  const [copied, setCopied] = useState(false)

  // Парсим тело запроса из requestBody (OpenAPI)
  let bodySchema = null
  let bodyExample = null
  if (ep.requestBody?.content?.['application/json']?.schema) {
    bodySchema = ep.requestBody.content['application/json'].schema
    bodyExample = ep.requestBody.content['application/json'].example
  }

  const fullUrl = `${api?.server_url || ''}${ep.path}`

  const copyUrl = async () => {
    const text = `${ep.method} ${fullUrl}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard недоступен */ }
  }

  // ── Заметка ──
  const [note, setNote] = useState(ep.note || '')
  const [noteSaved, setNoteSaved] = useState(false)
  useEffect(() => { setNote(ep.note || '') }, [ep.id])
  const saveNote = async () => {
    try {
      await saveEndpointNote(api.id, ep.id, note)
      setNoteSaved(true)
      toast('Заметка сохранена', 'success')
      setTimeout(() => setNoteSaved(false), 1500)
    } catch (e) { toast('Ошибка: ' + e.message, 'error') }
  }

  // ── cURL ──
  const [curlCopied, setCurlCopied] = useState(false)
  const copyCurl = () => {
    const qp = queryParams.map(p => qp[p.name] ? `${p.name}=${encodeURIComponent(qp[p.name])}` : '').filter(Boolean)
    let url = (api?.server_url || '') + tryUrl + (qp.length ? '?' + qp.join('&') : '')
    const parts = [`curl -X ${ep.method} '${url}'`]
    if (auth.login || auth.password) parts.push(`-H 'Authorization: Basic ${b64(`${auth.login}:${auth.password}`)}'`)
    if (hasBody && bodyText.trim()) parts.push(`-H 'Content-Type: application/json'`, `-d '${bodyText.replace(/'/g, `'\\''`)}'`)
    navigator.clipboard.writeText(parts.join(' \\\n  '))
      .then(() => { setCurlCopied(true); toast('cURL скопирован', 'success'); setTimeout(() => setCurlCopied(false), 1600) })
      .catch(() => toast('Не удалось скопировать', 'error'))
  }

  // ── Песочница ──
  const pathParams = params.filter(p => p.in === 'path')
  const queryParams = params.filter(p => p.in === 'query')
  const hasBody = !!bodySchema && ep.method !== 'GET' && ep.method !== 'HEAD'

  const [pp, setPP] = useState({})
  const [qp, setQP] = useState({})
  const [auth, setAuth] = useState({ login: '', password: '' })
  const [bodyText, setBodyText] = useState(() =>
    bodyExample ? JSON.stringify(bodyExample, null, 2) : ''
  )
  const [tryRes, setTryRes] = useState(null)
  const [tryErr, setTryErr] = useState('')
  const [tryLoading, setTryLoading] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)

  const tryUrl = ep.path.replace(/\{([^}]+)\}/g, (m, name) => {
    const v = pp[name]
    return v != null && v !== '' ? encodeURIComponent(v) : m
  })

  const sendTry = async () => {
    setTryLoading(true); setTryErr(''); setTryRes(null)
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    if (auth.login || auth.password) headers['Authorization'] = 'Basic ' + b64(`${auth.login}:${auth.password}`)
    const query = {}
    for (const q of queryParams) {
      const v = qp[q.name]
      if (v != null && v !== '') query[q.name] = v
    }
    try {
      const r = await tryRequest({
        api_id: api?.id,
        method: ep.method,
        path: tryUrl,
        query,
        headers,
        body: hasBody ? bodyText : undefined
      })
      setTryRes(r)
    } catch (e) {
      setTryErr(e.message)
    } finally {
      setTryLoading(false)
    }
  }

  const prettyBody = (() => {
    if (!tryRes?.body) return '(пустой ответ)'
    try { return JSON.stringify(JSON.parse(tryRes.body), null, 2) } catch { return tryRes.body }
  })()

  return (
    <div className="ep-detail">
      {/* Шапка эндпоинта */}
      <div className="ep-head-card">
        <div className="ep-header">
          <span className={`badge-lg ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
          <h2>{ep.summary}</h2>
          <span
            className={`ep-star-lg ${isFav ? 'on' : ''}`}
            title={isFav ? 'Убрать из избранного' : 'В избранное'}
            onClick={() => onToggleFav?.()}
          >
            {isFav ? '★' : '☆'}
          </span>
        </div>
        <div className="ep-full-path">
          <span className="method-tag">{ep.method}</span>
          <span className="url">{fullUrl}</span>
          <button
            className={`btn-copy ${copied ? 'copied' : ''}`}
            onClick={copyUrl}
            title="Скопировать путь"
          >
            {copied ? '✓ Скопировано' : '⧉ Копировать'}
          </button>
        </div>
        {ep.description && <p className="ep-desc">{ep.description}</p>}
      </div>

      {/* Параметры */}
      {params.length > 0 && (
        <div className="card">
          <div className="card-title">Параметры</div>
          <table className="data-table">
            <thead>
              <tr><th>Имя</th><th>В</th><th>Тип</th><th>Обяз.</th><th>Описание</th></tr>
            </thead>
            <tbody>
              {params.map((p, i) => (
                <tr key={i}>
                  <td><code>{p.name}</code></td>
                  <td><span className="tag-in">{p.in}</span></td>
                  <td>{p.schema?.type || '-'}</td>
                  <td>{p.required ? <span className="param-req" title="Обязательный">✓</span> : ''}</td>
                  <td>{p.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Тело запроса */}
      {bodySchema && (
        <div className="card">
          <div className="card-title">Тело запроса</div>
          {bodyExample && (
            <pre className="code-block" style={{ marginBottom: 12 }}>
              {JSON.stringify(bodyExample, null, 2)}
            </pre>
          )}
          <pre className="code-block">{JSON.stringify(bodySchema, null, 2)}</pre>
        </div>
      )}

      {/* Коды ответов — в столбик */}
      <div className="card">
        <div className="card-title">Коды ответов</div>
        <div className="resp-list">
          {Object.entries(responses).map(([code, detail]) => (
            <div key={code} className={`resp-item ${respClass(parseInt(code))}`}>
              <span className="resp-badge">{code}</span>
              <span className="resp-desc">{detail.description || ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Заметка */}
      <div className="card">
        <div className="card-title">Заметка</div>
        <textarea
          className="note-area"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={isAdmin ? 'Заметка интегратора: особенности, договорённости, тонкости API…' : 'Заметка (редактирование доступно администратору)'}
          rows={3}
          disabled={!isAdmin}
          spellCheck={false}
        />
        {isAdmin && (
          <button className="btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={saveNote}>
            {noteSaved ? '✓ Сохранено' : 'Сохранить заметку'}
          </button>
        )}
      </div>

      {/* Песочница */}
      <div className="card">
        <div className="card-title">Песочница</div>
        {!api?.server_url ? (
          <p className="muted">У API не задан server_url — тестовый запрос отправить нельзя.</p>
        ) : (
          <>
            <div className="try-url">
              <span className={`badge-lg ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
              <code>{api.server_url}{tryUrl}</code>
            </div>

            {(pathParams.length > 0 || queryParams.length > 0) && (
              <div className="try-params">
                {pathParams.map(p => (
                  <label key={`pp-${p.name}`} className="try-field">
                    <span className="try-field-name">{'{' + p.name + '}'}</span>
                    <input
                      value={pp[p.name] || ''}
                      onChange={e => setPP(s => ({ ...s, [p.name]: e.target.value }))}
                      placeholder={p.description || 'path-параметр'}
                    />
                  </label>
                ))}
                {queryParams.map(p => (
                  <label key={`qp-${p.name}`} className="try-field">
                    <span className="try-field-name">{p.name}</span>
                    <input
                      value={qp[p.name] || ''}
                      onChange={e => setQP(s => ({ ...s, [p.name]: e.target.value }))}
                      placeholder={p.description || 'query-параметр'}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="try-auth">
              <button type="button" className="try-auth-toggle" onClick={() => setAuthOpen(o => !o)}>
                {authOpen ? '▾' : '▸'} Basic-авторизация {auth.login ? '· задана' : ''}
              </button>
              {authOpen && (
                <div className="try-auth-fields">
                  <input placeholder="Логин" value={auth.login}
                    onChange={e => setAuth(s => ({ ...s, login: e.target.value }))} />
                  <input placeholder="Пароль" type="password" value={auth.password}
                    onChange={e => setAuth(s => ({ ...s, password: e.target.value }))} />
                </div>
              )}
            </div>

            {hasBody && (
              <textarea
                className="try-body"
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                placeholder='{ "json": "тело запроса" }'
                rows={8}
                spellCheck={false}
              />
            )}

            <button className="btn-primary try-send" onClick={sendTry} disabled={tryLoading}>
              {tryLoading ? 'Отправка…' : '▶ Отправить запрос'}
            </button>
            <button className="btn-secondary" style={{ marginLeft: 10 }} onClick={copyCurl}>
              {curlCopied ? '✓ Скопировано' : '⧉ cURL'}
            </button>

            {tryErr && <div className="error-box">{tryErr}</div>}

            {tryRes && (
              <div className="try-result">
                <div className="try-meta">
                  <span className={`resp-badge standalone ${respClass(tryRes.status)}`}>{tryRes.status}</span>
                  <span className="muted">{tryRes.duration_ms} мс</span>
                  <span className="muted">{(tryRes.headers['content-type'] || '').split(';')[0]}</span>
                  {tryRes.truncated && <span className="muted">ответ обрезан</span>}
                </div>
                <pre className="code-block">{prettyBody}</pre>
                <details className="try-headers">
                  <summary>Заголовки ответа</summary>
                  <pre className="code-block">{JSON.stringify(tryRes.headers, null, 2)}</pre>
                </details>
              </div>
            )}
          </>
        )}
      </div>

      {/* Сваггер */}
      {api?.swagger_url && (
        <a className="btn-apidocs" href={api.swagger_url}>
          📖 Открыть в Swagger UI
        </a>
      )}
    </div>
  )
}
