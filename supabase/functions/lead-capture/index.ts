// ─────────────────────────────────────────────────────────────────────────
// Edge Function: lead-capture
// Endpoint PÚBLICO de captação de leads. Cada canal de captação tem um slug;
// o formulário/quiz externo faz POST aqui informando o slug do canal e os
// dados do lead. A função descobre o projeto e a origem pelo canal e grava
// o lead já no projeto certo.
//
// POST { channel: "<slug>", lead: { nome, telefone, email, ... } }
// (os campos do lead também podem vir na raiz do corpo)
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  let body: Record<string, any>
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }

  const slug = body.channel || body.slug
  if (!slug) return json({ error: 'Canal de captação não informado' }, 400)

  const { data: ch } = await admin.from('capture_channels')
    .select('*').eq('slug', slug).maybeSingle()
  if (!ch) return json({ error: 'Canal de captação não encontrado' }, 404)
  if (ch.active === false) return json({ error: 'Canal de captação inativo' }, 403)

  const lead = body.lead || body
  if (!lead.nome && !lead.telefone && !lead.email) {
    return json({ error: 'Informe ao menos nome, telefone ou e-mail' }, 400)
  }

  const row: Record<string, any> = {
    project_id: ch.project_id,
    source_type: lead.source_type || ch.source_type || 'outro',
    origem: 'Captação: ' + ch.name,
    pipeline_status: 'lead_criado',
    nome: lead.nome || null,
    telefone: lead.telefone || null,
    email: lead.email || null,
    instagram: lead.instagram || null,
    faturamento: lead.faturamento || null,
    momento: lead.momento || null,
    nota_geral: lead.nota_geral ?? null,
    observacoes: lead.observacoes || lead.mensagem || null,
    interesse: lead.interesse || null,
  }
  Object.keys(row).forEach(k => { if (row[k] === null) delete row[k] })
  row.project_id = ch.project_id
  row.pipeline_status = 'lead_criado'

  const { data: inserted, error } = await admin.from('leads')
    .insert(row).select('id').single()
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, lead_id: inserted.id, project_id: ch.project_id })
})
