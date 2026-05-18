// ─────────────────────────────────────────────────────────────────────────
// Edge Function: run-automations
// Motor das automações. Chamada a cada minuto por um cron no VPS.
// Autorização: o chamador precisa apresentar a SERVICE_ROLE_KEY no header
// Authorization (só o cron do servidor tem essa chave).
//
// A cada execução:
//   1. Envia as mensagens agendadas (scheduled_messages) já vencidas.
//   2. Envia lembretes de reunião 1 dia / 1 hora antes (automation_settings).
//
// Envio via WhatsApp Cloud API, usando whatsapp_config. Se o WhatsApp não
// estiver configurado, não faz nada (deixa tudo pendente para depois).
//
// Deploy: cópia executada em /root/supabase/docker/volumes/functions/.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
function digits(s: unknown) { return String(s || '').replace(/\D/g, '') }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}
function fill(tpl: string, lead: any, appt: any) {
  const nome = lead?.nome ? String(lead.nome).trim().split(/\s+/)[0] : ''
  return String(tpl || '')
    .replaceAll('{nome}', nome)
    .replaceAll('{data}', appt ? fmtDate(appt.starts_at) : '')
    .replaceAll('{hora}', appt ? fmtTime(appt.starts_at) : '')
}

async function sendWhatsApp(cfg: any, phone: unknown, text: string) {
  const to = digits(phone)
  if (!to) return { ok: false, error: 'contato sem telefone' }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: j?.error?.message || ('HTTP ' + res.status) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (token !== SERVICE_ROLE_KEY) return json({ error: 'não autorizado' }, 401)

  const result: Record<string, unknown> = {
    scheduled_sent: 0, scheduled_failed: 0, reminders_1d: 0, reminders_1h: 0, skipped: null,
  }

  // WhatsApp precisa estar configurado e ativo
  const { data: cfg } = await admin.from('whatsapp_config').select('*').eq('id', 1).maybeSingle()
  if (!cfg || !cfg.enabled || !cfg.token || !cfg.phone_number_id) {
    result.skipped = 'WhatsApp não configurado — nenhum envio feito'
    return json(result)
  }

  const now = new Date()

  // ── 1. Mensagens agendadas vencidas ──
  const { data: due } = await admin.from('scheduled_messages')
    .select('*, leads(nome, telefone)')
    .eq('status', 'pending').lte('send_at', now.toISOString()).limit(50)
  for (const m of (due || [])) {
    const lead = (m as any).leads
    if (!lead || !lead.telefone) {
      await admin.from('scheduled_messages')
        .update({ status: 'failed', error: 'lead sem telefone' }).eq('id', m.id)
      result.scheduled_failed = (result.scheduled_failed as number) + 1
      continue
    }
    const r = await sendWhatsApp(cfg, lead.telefone, m.body)
    await admin.from('scheduled_messages').update(
      r.ok ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
           : { status: 'failed', error: r.error }
    ).eq('id', m.id)
    if (r.ok) {
      result.scheduled_sent = (result.scheduled_sent as number) + 1
      await admin.from('notifications').insert({
        user_id: m.vendedor_id, type: 'automation', lead_id: m.lead_id,
        title: 'Mensagem automática enviada',
        body: 'Sua mensagem agendada para ' + (lead.nome || 'o lead') + ' foi enviada.',
      })
    } else {
      result.scheduled_failed = (result.scheduled_failed as number) + 1
    }
  }

  // ── 2. Lembretes de reunião ──
  const { data: aset } = await admin.from('automation_settings').select('*').eq('id', 1).maybeSingle()
  if (aset) {
    const in24h = new Date(now.getTime() + 24 * 3600 * 1000).toISOString()
    const in1h = new Date(now.getTime() + 3600 * 1000).toISOString()

    if (aset.remind_1d_enabled) {
      const { data: appts } = await admin.from('appointments')
        .select('*, leads(nome, telefone)')
        .is('reminder_1d_sent_at', null).not('lead_id', 'is', null)
        .gt('starts_at', now.toISOString()).lte('starts_at', in24h).limit(50)
      for (const a of (appts || [])) {
        const lead = (a as any).leads
        if (lead && lead.telefone) {
          const r = await sendWhatsApp(cfg, lead.telefone, fill(aset.remind_1d_text, lead, a))
          if (r.ok) {
            result.reminders_1d = (result.reminders_1d as number) + 1
            await admin.from('notifications').insert({
              user_id: a.vendedor_id, type: 'automation', lead_id: a.lead_id,
              title: 'Lembrete enviado',
              body: 'Lembrete (1 dia antes) enviado para ' + (lead.nome || 'o lead') + '.',
            })
          }
        }
        await admin.from('appointments')
          .update({ reminder_1d_sent_at: new Date().toISOString() }).eq('id', a.id)
      }
    }

    if (aset.remind_1h_enabled) {
      const { data: appts } = await admin.from('appointments')
        .select('*, leads(nome, telefone)')
        .is('reminder_1h_sent_at', null).not('lead_id', 'is', null)
        .gt('starts_at', now.toISOString()).lte('starts_at', in1h).limit(50)
      for (const a of (appts || [])) {
        const lead = (a as any).leads
        if (lead && lead.telefone) {
          const r = await sendWhatsApp(cfg, lead.telefone, fill(aset.remind_1h_text, lead, a))
          if (r.ok) {
            result.reminders_1h = (result.reminders_1h as number) + 1
            await admin.from('notifications').insert({
              user_id: a.vendedor_id, type: 'automation', lead_id: a.lead_id,
              title: 'Lembrete enviado',
              body: 'Lembrete (1 hora antes) enviado para ' + (lead.nome || 'o lead') + '.',
            })
          }
        }
        await admin.from('appointments')
          .update({ reminder_1h_sent_at: new Date().toISOString() }).eq('id', a.id)
      }
    }
  }

  return json(result)
})
