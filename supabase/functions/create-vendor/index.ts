// ─────────────────────────────────────────────────────────────────────────
// Edge Function: create-vendor
// Cria um novo vendedor/admin server-side usando a service_role key.
//
// Por que existe: o fluxo antigo no cliente usava supabase.auth.signUp(), que
//   (1) trocava a sessão do admin pela do usuário recém-criado e
//   (2) dependia da falha de escalação de privilégio para definir o `role`.
// Aqui o usuário é criado pela service_role, sem tocar na sessão do admin, e o
// trigger protect_profile_role é ignorado (a sessão é service_role, não authenticated).
//
// Deploy: este arquivo é a fonte versionada. A cópia executada fica em
//   /root/supabase/docker/volumes/functions/create-vendor/index.ts no VPS.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  // 1. Token do chamador
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sem token de autenticação' }, 401)

  // 2. Identifica o chamador a partir do token
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: userErr } = await caller.auth.getUser()
  if (userErr || !user) return json({ error: 'Sessão inválida' }, 401)

  // 3. Cliente service_role (ignora RLS e o trigger de role)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // 4. Só admin pode criar usuários
  const { data: callerProfile } = await admin
    .from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Apenas administradores podem criar usuários' }, 403)
  }

  // 5. Valida o corpo
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const phone = String(body.phone ?? '').trim()
  const role = body.role === 'admin' ? 'admin' : 'vendedor'
  const permissions = (body.permissions ?? {}) as Record<string, unknown>
  if (!name || !email || !password) return json({ error: 'Preencha nome, email e senha' }, 400)
  if (password.length < 6) return json({ error: 'Senha precisa de no mínimo 6 caracteres' }, 400)

  // 6. Cria o usuário (o trigger handle_new_user cria o profile com role=vendedor)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name, role },
  })
  if (createErr || !created.user) {
    return json({ error: createErr?.message ?? 'Falha ao criar usuário' }, 400)
  }

  // 7. Ajusta o profile com nome, telefone, role e permissões
  const { error: profErr } = await admin.from('profiles')
    .update({ nome: name, telefone: phone, role, permissions })
    .eq('id', created.user.id)
  if (profErr) {
    // rollback: remove o usuário recém-criado para não deixar lixo
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: 'Erro ao salvar perfil: ' + profErr.message }, 500)
  }

  return json({ ok: true, id: created.user.id, email, role })
})
