// ─────────────────────────────────────────────────────────────────────────
// Edge Function: google-calendar
// Conecta a conta Google de cada usuário (OAuth) e sincroniza os
// compromissos da Agenda do CRM com o Google Calendar.
//
// Ações (POST { action, ... }):
//   status          → { connected, email }
//   oauth-url       → { url }              monta a URL de consentimento
//   oauth-callback  → { ok, email }        troca o code por tokens
//   disconnect      → { ok }               apaga os tokens do usuário
//   sync-event      → { ok, google_event_id }  cria/atualiza/apaga evento
//
// Tokens ficam em public.google_tokens — acessados só por esta função
// (service_role). As credenciais OAuth do app vêm de public.google_config.
//
// Deploy: cópia executada em /root/supabase/docker/volumes/functions/.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const TZ = 'America/Sao_Paulo'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

async function getCreds() {
  const { data } = await admin.from('google_config')
    .select('client_id, client_secret').eq('id', 1).maybeSingle()
  return data
}

// Devolve um access_token válido, renovando via refresh_token se preciso.
async function getFreshToken(userId: string, creds: any): Promise<string | null> {
  const { data: tok } = await admin.from('google_tokens')
    .select('*').eq('user_id', userId).maybeSingle()
  if (!tok || !tok.refresh_token) return null
  const expiry = tok.token_expiry ? new Date(tok.token_expiry).getTime() : 0
  if (tok.access_token && expiry > Date.now() + 60000) return tok.access_token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: tok.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  const j = await res.json()
  if (!res.ok || !j.access_token) return null
  const newExpiry = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString()
  await admin.from('google_tokens')
    .update({ access_token: j.access_token, token_expiry: newExpiry, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  return j.access_token
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  // Identifica o usuário pelo JWT do Supabase
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sem token de autenticação' }, 401)
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: uErr } = await caller.auth.getUser()
  if (uErr || !user) return json({ error: 'Sessão inválida' }, 401)

  let body: Record<string, any>
  try { body = await req.json() } catch { body = {} }
  const action = body.action

  // STATUS — não exige credenciais
  if (action === 'status') {
    const { data: tok } = await admin.from('google_tokens')
      .select('google_email, refresh_token').eq('user_id', user.id).maybeSingle()
    return json({ connected: !!(tok && tok.refresh_token), email: tok?.google_email || null })
  }

  // DISCONNECT
  if (action === 'disconnect') {
    await admin.from('google_tokens').delete().eq('user_id', user.id)
    return json({ ok: true })
  }

  // As demais ações exigem as credenciais OAuth configuradas
  const creds = await getCreds()
  if (!creds || !creds.client_id || !creds.client_secret) {
    return json({ error: 'Integração Google não configurada (Configurações → Google).' }, 400)
  }

  // OAUTH-URL — monta a URL de consentimento do Google
  if (action === 'oauth-url') {
    const redirectUri = body.redirect_uri
    if (!redirectUri) return json({ error: 'redirect_uri ausente' }, 400)
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state: body.state || '',
    }).toString()
    return json({ url })
  }

  // OAUTH-CALLBACK — troca o code por tokens
  if (action === 'oauth-callback') {
    const { code, redirect_uri } = body
    if (!code || !redirect_uri) return json({ error: 'code/redirect_uri ausentes' }, 400)
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri,
      }),
    })
    const j = await res.json()
    if (!res.ok || !j.access_token) {
      return json({ error: 'Falha ao conectar: ' + (j.error_description || j.error || 'erro') }, 400)
    }
    let email: string | null = null
    try {
      const ui = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${j.access_token}` },
      })
      email = (await ui.json()).email || null
    } catch (_) { /* ignora */ }

    const row: Record<string, any> = {
      user_id: user.id,
      access_token: j.access_token,
      token_expiry: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
      google_email: email,
      updated_at: new Date().toISOString(),
    }
    // refresh_token só vem na 1ª autorização — preserva o existente se não vier
    if (j.refresh_token) {
      row.refresh_token = j.refresh_token
    } else {
      const { data: ex } = await admin.from('google_tokens')
        .select('refresh_token').eq('user_id', user.id).maybeSingle()
      if (ex?.refresh_token) row.refresh_token = ex.refresh_token
    }
    if (!row.refresh_token) {
      return json({ error: 'O Google não devolveu refresh_token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.' }, 400)
    }
    await admin.from('google_tokens').upsert(row)
    return json({ ok: true, email })
  }

  // SYNC-EVENT — cria / atualiza / apaga um evento no Google Calendar
  if (action === 'sync-event') {
    const accessToken = await getFreshToken(user.id, creds)
    if (!accessToken) return json({ ok: true, connected: false, skipped: true })

    const op = body.op
    const a = body.appointment || {}
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

    try {
      if (op === 'delete') {
        if (a.google_event_id) {
          await fetch(`${base}/${a.google_event_id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
          })
        }
        return json({ ok: true })
      }

      const eventBody = {
        summary: a.title || 'Compromisso',
        description: a.notes || '',
        location: a.location || '',
        start: { dateTime: a.starts_at, timeZone: TZ },
        end: { dateTime: a.ends_at, timeZone: TZ },
      }
      const isUpdate = op === 'update' && a.google_event_id
      const res = await fetch(isUpdate ? `${base}/${a.google_event_id}` : base, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      })
      const j = await res.json()
      if (!res.ok) return json({ error: 'Google Calendar: ' + (j.error?.message || 'erro') }, 400)
      return json({ ok: true, google_event_id: j.id })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
