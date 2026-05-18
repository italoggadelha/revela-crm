// ─────────────────────────────────────────────────────────────────────────
// Edge Function: proposal
// Função PÚBLICA usada pela página de proposta (proposta.html). Permite o
// cliente ver a proposta e registrar o aceite (dados para o contrato).
//
// Ações (POST { action, ... }):
//   get    → dados da proposta para renderizar a apresentação
//   accept → grava o aceite do cliente (status = accepted)
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

  const id = body.id
  if (!id) return json({ error: 'Proposta inválida' }, 400)

  // GET — dados para a apresentação
  if (body.action === 'get') {
    const { data: p } = await admin.from('proposals').select('*').eq('id', id).maybeSingle()
    if (!p) return json({ error: 'Proposta não encontrada' }, 404)
    let vendedor = 'MyLion'
    const { data: prof } = await admin.from('profiles')
      .select('nome, email').eq('id', p.vendedor_id).maybeSingle()
    if (prof) vendedor = prof.nome || (prof.email || '').split('@')[0]
    return json({
      client_name: p.client_name,
      client_niche: p.client_niche,
      client_context: p.client_context,
      deliverables: p.deliverables || [],
      payment: p.payment,
      setup_fee: p.setup_fee,
      monthly_fee: p.monthly_fee,
      contract_months: p.contract_months,
      status: p.status,
      vendedor,
      created_at: p.created_at,
    })
  }

  // ACCEPT — registra o aceite do cliente
  if (body.action === 'accept') {
    const d = body.data || {}
    if (!d.nome || !d.email) return json({ error: 'Preencha ao menos nome e e-mail' }, 400)
    const { data: prop } = await admin.from('proposals')
      .select('lead_id').eq('id', id).maybeSingle()
    const { error } = await admin.from('proposals').update({
      accepted_data: d,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) return json({ error: error.message }, 500)
    // Aceite → move o lead para a etapa de venda realizada
    if (prop && prop.lead_id) {
      const { data: pc } = await admin.from('pipeline_config')
        .select('columns').eq('id', 1).maybeSingle()
      const cols = (pc && pc.columns) || []
      const stage = cols.find((c: any) => c.id === 'vendida')
        || cols.find((c: any) => /vend/i.test(c.label || ''))
      if (stage) {
        await admin.from('leads').update({ pipeline_status: stage.id }).eq('id', prop.lead_id)
      }
    }
    return json({ ok: true })
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
