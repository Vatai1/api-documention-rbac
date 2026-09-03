/**
 * Парсер спецификаций API из .docx (табличный формат спецификаций ЕКС/АИСА).
 * ZIP читается встроенным zlib (без внешних зависимостей).
 */
import zlib from 'zlib'

// ── Минимальный ZIP-ридер: достаёт файл из архива по имени ──
export function readZipEntry(buffer, wantedName) {
  // EOCD (End of Central Directory)
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('ZIP: не найден End of Central Directory')
  const entries = buffer.readUInt16LE(eocd + 10)
  let ptr = buffer.readUInt32LE(eocd + 16)

  for (let n = 0; n < entries; n++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('ZIP: битая Central Directory')
    const method = buffer.readUInt16LE(ptr + 10)
    const compSize = buffer.readUInt32LE(ptr + 20)
    const nameLen = buffer.readUInt16LE(ptr + 28)
    const extraLen = buffer.readUInt16LE(ptr + 30)
    const commentLen = buffer.readUInt16LE(ptr + 32)
    const localOff = buffer.readUInt32LE(ptr + 42)
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    if (name === wantedName) {
      // Local file header: 30 байт + name + extra
      const lNameLen = buffer.readUInt16LE(localOff + 26)
      const lExtraLen = buffer.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const raw = buffer.subarray(dataStart, dataStart + compSize)
      if (method === 0) return raw.toString('utf8')          // stored
      if (method === 8) return zlib.inflateRawSync(raw).toString('utf8') // deflate
      throw new Error('ZIP: неподдерживаемый метод сжатия ' + method)
    }
    ptr += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// ── XML → текст ──
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&amp;/g, '&')
}

function xmlToText(xml) {
  return decodeEntities(xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

// ── Топ-уровневые элементы body: текстовые блоки и таблицы по порядку ──
function extractElements(docXml) {
  const bodyM = docXml.match(/<w:body>([\s\S]*)<\/w:body>/)
  const body = bodyM ? bodyM[1] : docXml
  const out = []
  const re = /<w:tbl[\s>]|<\/w:tbl>/g
  let depth = 0, tblStart = -1, last = 0, m
  while ((m = re.exec(body))) {
    if (m[0] === '</w:tbl>') {
      depth--
      if (depth === 0 && tblStart >= 0) {
        out.push({ type: 'text', text: xmlToText(body.slice(last, tblStart)) })
        out.push({ type: 'tbl', xml: body.slice(tblStart, m.index + m[0].length) })
        last = re.lastIndex
        tblStart = -1
      }
    } else {
      if (depth === 0) tblStart = m.index
      depth++
    }
  }
  out.push({ type: 'text', text: xmlToText(body.slice(last)) })
  return out.filter(e => e.type === 'tbl' || (e.text && e.text.trim()))
}

function parseTable(tblXml) {
  const rows = []
  const trRe = /<w:tr[\s>][\s\S]*?<\/w:tr>/g
  let tr
  while ((tr = trRe.exec(tblXml))) {
    const cells = []
    const tcRe = /<w:tc>[\s\S]*?<\/w:tc>/g
    let tc
    while ((tc = tcRe.exec(tr[0]))) cells.push(xmlToText(tc[0]).replace(/\n/g, ' ').trim())
    if (cells.length) rows.push(cells)
  }
  return rows
}

function tableKind(rows) {
  const h = (rows[0] || []).join('|').toLowerCase()
  if (h.includes('код http')) return 'responses'
  // Таблица «Входные данные»: № | Параметр | Значение параметра | … (URL endpoint — строка данных)
  if (h.includes('значение параметра')) return 'inputs'
  if (h.includes('код параметра')) return 'params'
  return 'unknown'
}

function extractJson(text) {
  const s = text.indexOf('{')
  if (s < 0) return null
  const e = text.lastIndexOf('}')
  if (e <= s) return null
  const raw = text.slice(s, e + 1)
  try { return JSON.parse(raw) } catch { /* пробуем починить висячие запятые */ }
  try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) } catch { return null }
}

/**
 * Главная функция: XML word/document.xml → OpenAPI 3.0.3 spec
 */
export function parseDocxSpec(docXml, fallbackTitle) {
  const elems = extractElements(docXml)
  const schemas = {}
  const paths = {}
  const headerLines = []
  let pendingTitle = true

  // Контекст: какая таблица параметров ожидается следующей
  let ctx = { kind: 'none' }
  let cur = null
  let lastHeading = ''
  let expectExample = null
  // Многострочный JSON-буфер (примеры в docx разбиты на несколько абзацев)
  let jsonBuf = null
  const braceDelta = s => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length

  const fmtType = (format, comment) => {
    const f = String(format || '').toLowerCase()
    if (f.includes('boolean')) return { type: 'boolean' }
    if (f.includes('long') || f.includes('integer') || /\bint\b/.test(f)) return { type: 'integer' }
    if (f.includes('array') || f.includes('массив')) return { type: 'array', items: { type: 'string' } }
    if (f.includes('комплексн')) {
      const m = String(comment || '').match(/[«"]([^»"]+)[»"]/)
      if (m) return { $ref: '#/components/schemas/' + m[1] }
      return { type: 'object' }
    }
    return { type: 'string' }
  }

  const propsToSchema = (list) => ({
    type: 'object',
    properties: Object.fromEntries(list.map(p => [p.name, {
      ...(p.desc ? { description: p.desc } : {}),
      ...fmtType(p.format, p.comment)
    }])),
    required: list.filter(p => p.req).map(p => p.name)
  })

  const finalize = () => {
    if (!cur || !cur.url) return
    const clean = cur.url.trim().replace(/^\/+/, '')
    if (!clean) return
    const path = '/' + clean
    const method = (cur.method || 'POST').toLowerCase()
    const parameters = [
      ...(cur.pathParams || []).map(q => ({ name: q.name, in: 'path', required: true, description: q.desc || '', schema: fmtType(q.format, q.comment) })),
      ...(cur.queryParams || []).map(q => ({ name: q.name, in: 'query', required: !!q.req, description: q.desc || '', schema: fmtType(q.format, q.comment) }))
    ]
    const responses = {}
    for (const r of (cur.responses || [])) {
      responses[r.code] = { description: r.msg && r.msg !== '-' ? r.msg : 'Успешная обработка запроса' }
    }
    if ((cur.respProps || []).length && responses['200']) {
      responses['200'].content = { 'application/json': { schema: propsToSchema(cur.respProps) } }
      if (cur.respExample != null) responses['200'].content['application/json'].example = cur.respExample
    }
    const op = {
      summary: cur.summary || path,
      description: cur.desc || '',
      operationId: path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + method,
      tags: [path.split('/').filter(Boolean)[0] || 'Прочее'],
      parameters,
      responses
    }
    if ((cur.bodyProps || []).length || cur.reqExample != null) {
      op.requestBody = { required: true, content: { 'application/json': {} } }
      if ((cur.bodyProps || []).length) op.requestBody.content['application/json'].schema = propsToSchema(cur.bodyProps)
      if (cur.reqExample != null) op.requestBody.content['application/json'].example = cur.reqExample
    }
    if (!paths[path]) paths[path] = {}
    paths[path][method] = op
  }

  for (const el of elems) {
    if (el.type === 'text') {
      for (const line of el.text.split('\n')) {
        const t = line.trim()
        if (!t) continue
        if (pendingTitle) {
          if (/лист изменений/i.test(t)) pendingTitle = false
          else if (t.length > 3) headerLines.push(t.slice(0, 120))
        }
        if (/^описание комплексного типа/i.test(t)) {
          const m = t.match(/[«"]([^»"]+)[»"]/)
          if (m) ctx = { kind: 'schema', name: m[1] }
        } else if (/параметров адреса/i.test(t)) ctx = { kind: 'path' }
        else if (/параметров запроса/i.test(t)) ctx = { kind: 'query' }
        else if (/тела запроса/i.test(t)) ctx = { kind: 'body' }
        else if (/коды обработки запроса/i.test(t)) ctx = { kind: 'responses' }
        else if (/выходные данные/i.test(t)) ctx = { kind: 'responseSchema' }
        if (/^описание взаимодействия/i.test(t)) lastHeading = t
        if (/пример запроса/i.test(t)) expectExample = 'request'
        else if (/пример ответа/i.test(t)) expectExample = 'response'

        // Накопление многострочного JSON
        if (jsonBuf !== null) {
          jsonBuf += '\n' + t
          const d = braceDelta(jsonBuf)
          if (d === 0) {
            const json = extractJson(jsonBuf)
            if (json != null && cur) {
              if (expectExample === 'request') { cur.reqExample = json; expectExample = null }
              else if (expectExample === 'response') { cur.respExample = json; expectExample = null }
            }
            jsonBuf = null
          } else if (d < 0) {
            jsonBuf = null // рассинхрон скобок — сдаёмся
          }
        } else if (t.includes('{')) {
          if (braceDelta(t) === 0) {
            const json = extractJson(t)
            if (json != null && cur) {
              if (expectExample === 'request') { cur.reqExample = json; expectExample = null }
              else if (expectExample === 'response') { cur.respExample = json; expectExample = null }
            }
          } else {
            jsonBuf = t
          }
        }
      }
    } else {
      const rows = parseTable(el.xml)
      const kind = tableKind(rows)
      if (kind === 'inputs') {
        finalize()
        cur = { responses: [], pathParams: [], queryParams: [], bodyProps: [], summary: lastHeading }
        for (const r of rows.slice(1)) {
          const key = String(r[1] || '').toLowerCase()
          const val = String(r[2] || '').trim()
          if (key.includes('url endpoint')) cur.url = val
          else if (key.includes('method')) cur.method = val.toUpperCase()
        }
      } else if (kind === 'params') {
        const list = rows.slice(1)
          .map(r => ({ name: r[1], desc: r[2], req: String(r[3] || '').trim().startsWith('+'), format: r[4], comment: r[5] }))
          .filter(p => p.name)
        if (ctx.kind === 'schema' && ctx.name) {
          schemas[ctx.name] = propsToSchema(list)
          if (!schemas[ctx.name].required.length) delete schemas[ctx.name].required
        } else if (ctx.kind === 'responseSchema' && cur) cur.respProps = list
        else if (ctx.kind === 'path' && cur) cur.pathParams = list
        else if (ctx.kind === 'query' && cur) cur.queryParams = list
        else if (ctx.kind === 'body' && cur) cur.bodyProps = list
      } else if (kind === 'responses') {
        if (cur) {
          cur.responses = rows.slice(1)
            .map(r => ({ code: String(r[1] || '').trim(), msg: String(r[2] || '').trim() }))
            .filter(x => x.code)
        }
      }
    }
  }
  finalize()

  // Убираем битые $ref (схема не найдена)
  const fixRefs = (obj) => {
    if (Array.isArray(obj)) { obj.forEach(fixRefs); return }
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        if (v && typeof v === 'object' && v.$ref) {
          const name = v.$ref.split('/').pop()
          if (!schemas[name]) obj[k] = { type: 'object' }
        } else fixRefs(v)
      }
    }
  }
  fixRefs(paths)

  const title = (headerLines.slice(0, 3).join(' ') || fallbackTitle || 'Спецификация API').slice(0, 200)
  return {
    openapi: '3.0.3',
    info: {
      title,
      description: headerLines.slice(0, 8).join('\n'),
      version: '1.0.0'
    },
    servers: [],
    paths,
    components: { schemas }
  }
}
