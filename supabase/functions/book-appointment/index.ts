// ─────────────────────────────────────────────────────────────────────────
// Edge Function: book-appointment
// Função PÚBLICA usada pela página de agendamento (agendar.html) — o próprio
// lead escolhe data/horário e marca a reunião. Não exige login.
//
// Ações (POST { action, v, ... }):
//   info → { vendedor, busy[], lead }   dados do vendedor + horários ocupados
//   book → { ok }                       cria o compromisso
//
// `v` é o id do profile do vendedor (vai na URL do link de agendamento).
// Tudo é feito com service_role; valida que `v` é um vendedor real.
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

  const v = body.v
  if (!v) return json({ error: 'Link de agendamento inválido' }, 400)

  // Valida o vendedor
  const { data: prof } = await admin.from('profiles')
    .select('id, nome, email').eq('id', v).maybeSingle()
  if (!prof) return json({ error: 'Link de agendamento inválido' }, 400)
  const vendedorNome = prof.nome || (prof.email || '').split('@')[0]

  // INFO — vendedor + horários ocupados + dados do lead (se houver)
  if (body.action === 'info') {
    const from = body.from || new Date().toISOString()
    const to = body.to || new Date(Date.now() + 30 * 864e5).toISOString()
    const { data: appts } = await admin.from('appointments')
      .select('starts_at, ends_at')
      .eq('vendedor_id', v)
      .gte('starts_at', from).lte('starts_at', to)
    let lead = null
    if (body.lead) {
      const { data: l } = await admin.from('leads')
        .select('nome, telefone').eq('id', body.lead).maybeSingle()
      if (l) lead = { nome: l.nome, telefone: l.telefone }
    }
    return json({ vendedor: vendedorNome, busy: (appts || []).map(a => a.starts_at), lead })
  }

  // BOOK — cria o compromisso
  if (body.action === 'book') {
    const { starts_at, ends_at, name, phone, lead } = body
    if (!starts_at || !ends_at || !name) {
      return json({ error: 'Preencha nome, data e horário' }, 400)
    }
    if (new Date(starts_at).getTime() < Date.now()) {
      return json({ error: 'Escolha um horário futuro' }, 400)
    }
    // Evita choque de horário
    const { data: clash } = await admin.from('appointments')
      .select('id').eq('vendedor_id', v)
      .lt('starts_at', ends_at).gt('ends_at', starts_at).limit(1)
    if (clash && clash.length) {
      return json({ error: 'Esse horário acabou de ser ocupado. Escolha outro.' }, 409)
    }
    const { error } = await admin.from('appointments').insert({
      vendedor_id: v,
      lead_id: lead || null,
      title: 'Reunião com ' + name,
      starts_at, ends_at,
      notes: 'Agendado pelo lead via link.' + (phone ? ' Telefone: ' + phone : ''),
    })
    if (error) return json({ error: error.message }, 500)

    // Move o lead para a etapa "agendou" do pipeline
    if (lead) {
      const { data: pc } = await admin.from('pipeline_config')
        .select('columns').eq('id', 1).maybeSingle()
      const cols = (pc && pc.columns) || []
      const stage = cols.find((c: any) => c.id === 'agendou')
        || cols.find((c: any) => /agend|reuni/i.test(c.label || ''))
      if (stage) {
        await admin.from('leads').update({ pipeline_status: stage.id }).eq('id', lead)
      }
    }
    return json({ ok: true, vendedor: vendedorNome })
  }

  return json({ error: 'Ação desconhecida' }, 400)
})
