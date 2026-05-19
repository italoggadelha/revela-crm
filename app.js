// ═══════════════════════════════════════════════════════════════════
// REVELA CRM v2 — App principal
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── Validação de config ───
  if (!window.CRM_CONFIG ||
      window.CRM_CONFIG.SUPABASE_URL === 'COLE_AQUI_SUPABASE_URL' ||
      !window.CRM_CONFIG.SUPABASE_URL) {
    document.body.innerHTML =
      '<div style="padding:40px;color:#DC2626;font-family:monospace">' +
      '<h2>⚠️ CRM não configurado</h2>' +
      '<p>Edite o arquivo <strong>config.js</strong> com as credenciais do Supabase.</p>' +
      '</div>';
    return;
  }

  const CONFIG = window.CRM_CONFIG;
  const supabase = window.supabase.createClient(
    CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true } }
  );

  // ─── Estado global ───
  const state = {
    user: null,
    profile: null,
    profiles: [],
    projects: [],
    projectId: null,
    captureChannels: [],
    pipeline: [],
    leads: [],
    filtered: [],
    currentView: 'dashboard',
    searchTerm: '',
    filters: { vendor: '', revenue: '', period: '' },
    dashFilter: { period: '', vendor: '', source: '' },
    currentLead: null,
    editingLead: null,
    sortables: [],
    charts: {},
    // Tarefas
    tasks: [],
    editingTask: null,
    editingSubtasks: [],
    expandedTasks: {},
    taskFilter: 'pending',
    // Playbook
    playbookTab: '',
    // Notificações
    notifications: [],
    // Configurações
    settingsSection: 'profile',
    // Agenda
    appointments: [],
    editingAppointment: null,
    agendaMonth: null,
    agendaSelectedDay: null,
    agendaView: 'month',
    googleStatus: { connected: false, email: null },
    // Automações
    scheduledMessages: [],
    automations: [],
    editingAutomation: null,
    autoSelected: 'reminders',
    auto2Tab: 'custom',
    schedMedia: null,
    // Propostas
    proposals: [],
    editingProposal: null,
    // Contato manual
    editingContact: null,
    contactProfileText: '',
    // Chat
    conversations: [],
    messages: {},                 // { conversationId: [msgs] }
    activeConversationId: null,
    chatSearchTerm: '',
    chatFilter: { unread: false, vendor: '' },
    leadHistory: {},
    chatInfoLead: null,
    chatInfoLeadId: null
  };

  // ─── Mapa de fontes (label + ícone + cor) ───
  const SOURCE_META = {
    trafego_pago:        { label: 'Tráfego pago',         icon: '💰', bg: '#FEF3C7' },
    stories:             { label: 'Stories',              icon: '📸', bg: '#FCE7F3' },
    bio_link:            { label: 'Link da bio',          icon: '🔗', bg: '#E0E7FF' },
    direct:              { label: 'Direct (DM)',          icon: '💬', bg: '#DCFCE7' },
    instagram_organico:  { label: 'Instagram orgânico',   icon: '📱', bg: '#FDF2F8' },
    facebook_organico:   { label: 'Facebook orgânico',    icon: '👥', bg: '#DBEAFE' },
    indicacao:           { label: 'Indicação',            icon: '🤝', bg: '#DCFCE7' },
    evento:              { label: 'Evento / networking',  icon: '🎤', bg: '#FEF3C7' },
    ligacao:             { label: 'Ligação',              icon: '📞', bg: '#E0E7FF' },
    whatsapp:            { label: 'WhatsApp',             icon: '💚', bg: '#DCFCE7' },
    direto:              { label: 'Acesso direto',        icon: '🌐', bg: '#F5F5F2' },
    outro:               { label: 'Outro / sem origem',   icon: '❓', bg: '#F5F5F2' }
  };

  function sourceMeta(t) { return SOURCE_META[t] || SOURCE_META.outro; }

  // ─── Calcula temperatura (60% poder de investir + 40% momento do diagnóstico) ───
  // Lead ideal REVELA = tem dinheiro pra investir + está no estágio certo do funil
  function calcTemperature(faturamento, notaGeral) {
    // PODER DE INVESTIR — peso 60%
    const fatMap = {
      'Até R$ 5 mil/mês':         2,  // pouco budget, lead frio
      'R$ 5 a R$ 15 mil/mês':     5,  // sweet spot inferior
      'R$ 15 a R$ 30 mil/mês':    5,  // sweet spot superior
      'R$ 30 a R$ 50 mil/mês':    4,  // pode investir mais que o ticket médio
      'Acima de R$ 50 mil/mês':   3   // grande, mas pode estar saturado
    };
    const money = fatMap[faturamento] || 2;

    // ESTÁGIO DO DIAGNÓSTICO — peso 40%
    let stage;
    if (notaGeral == null)        stage = 3;  // sem nota → assume médio
    else if (notaGeral < 1.5)     stage = 3;  // PARTIDA: precisa muito mas pode ser cedo demais
    else if (notaGeral < 2.5)     stage = 5;  // FUNDAÇÃO: target ideal — clareza da dor
    else if (notaGeral < 3.5)     stage = 5;  // ESTRUTURAÇÃO: target ideal — busca método
    else if (notaGeral < 4.5)     stage = 3;  // TRAÇÃO: já tem estrutura, precisa menos
    else                          stage = 1;  // MULTIPLICAÇÃO: maduro, baixa urgência

    // Combinado com pesos
    const score = (money * 0.6) + (stage * 0.4);
    return Math.min(5, Math.max(1, Math.round(score)));
  }

  function tempLabel(t) {
    return ({ 1: 'Frio', 2: 'Morno', 3: 'Quente', 4: 'Muito quente', 5: 'Ideal' })[t] || '—';
  }

  function tempGauge(t) {
    // No card: ícone de fogo animado, cor varia com a temperatura
    if (!t) t = 1;
    return `<span class="heat-icon" data-temp="${t}" title="Temperatura: ${tempLabel(t)} (${t}/5)">
      <svg viewBox="0 0 24 24" fill="currentColor"><use href="#i-flame"/></svg>
    </span>`;
  }

  function tempBadge(t) {
    if (!t) return '';
    return `<span class="temp-badge" data-temp="${t}"><svg style="width:9px;height:9px"><use href="#i-flame"/></svg>${tempLabel(t)}</span>`;
  }

  function tempMeter(t) {
    if (!t) t = 1;
    return `<div class="temp-meter" data-temp="${t}">
      <div class="temp-meter-bar">
        ${[1,2,3,4,5].map(i => `<span class="temp-meter-seg ${i <= t ? 'filled' : ''}"></span>`).join('')}
      </div>
      <div class="temp-meter-label">
        <svg style="width:12px;height:12px"><use href="#i-flame"/></svg>
        ${tempLabel(t)} <span style="color:var(--text-faded);font-weight:500">— ${t}/5</span>
      </div>
    </div>`;
  }

  function leadTemperature(lead) {
    if (lead.temperature) return lead.temperature;
    return calcTemperature(lead.faturamento, lead.nota_geral);
  }

  // ─── Lead Scoring COMPORTAMENTAL (0–100) ───
  // Metodologia moderna de CRM: o score reflete o COMPORTAMENTO REAL do lead
  // (avanço no funil, engajamento na conversa, reuniões, recência) somado ao
  // fit de perfil. Leads orgânicos e indicações pesam MAIS que tráfego pago —
  // tráfego frio ainda precisa ser aquecido. Recalculado em tempo real.
  function leadSignals(lead) {
    const convs = (state.conversations || []).filter(c =>
      c.lead_id === lead.id || (c.leads && c.leads.id === lead.id));
    let replied = false, lastActivity = 0;
    convs.forEach(c => {
      if (c.last_inbound_at) replied = true;
      const t = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      if (t > lastActivity) lastActivity = t;
    });
    let inbound = 0, outbound = 0;
    convs.forEach(c => (state.messages[c.id] || []).forEach(m => {
      if (m.direction === 'in') { inbound++; replied = true; } else outbound++;
    }));
    const appts = (state.appointments || []).filter(a => a.lead_id === lead.id);
    const followups = (state.tasks || []).filter(t => t.lead_id === lead.id);
    const lastTouch = Math.max(
      lastActivity,
      lead.ultima_atualizacao ? new Date(lead.ultima_atualizacao).getTime() : 0,
      lead.created_at ? new Date(lead.created_at).getTime() : 0
    );
    return { threads: convs.length, replied, inbound, outbound,
      appts: appts.length, followups: followups.length, lastTouch };
  }

  // Pontuação por etapa do funil (avanço comportamental real)
  function stageScorePts(lead) {
    const map = { lead_criado: 6, agendou: 17, call_realizada: 23,
      no_show: 9, negociando: 27, vendida: 30, perdida: 2 };
    if (map[lead.pipeline_status] != null) return map[lead.pipeline_status];
    const idx = state.pipeline.findIndex(s => s.id === lead.pipeline_status);
    if (idx < 0) return 6;
    return Math.round(6 + (idx / Math.max(1, state.pipeline.length - 1)) * 22);
  }

  function leadScoreParts(lead) {
    // 1) Avanço no funil — comportamento real de progresso (max 30)
    const funnelPts = stageScorePts(lead);
    // 2) Engajamento na conversa (max 22)
    const sig = leadSignals(lead);
    let engPts = 0;
    if (sig.threads > 0) engPts += 6;
    if (sig.replied) engPts += 10;
    engPts = Math.min(22, engPts + Math.min(6, sig.inbound * 2));
    // 3) Fit de perfil — capacidade de investir + clareza da dor (max 22)
    const fatMap = {
      'Até R$ 5 mil/mês': 7, 'R$ 5 a R$ 15 mil/mês': 13,
      'R$ 15 a R$ 30 mil/mês': 14, 'R$ 30 a R$ 50 mil/mês': 12,
      'Acima de R$ 50 mil/mês': 10
    };
    const n = lead.nota_geral;
    const momPts = n == null ? 4 : n < 1.5 ? 5 : n < 3.5 ? 8 : n < 4.5 ? 5 : 3;
    const fitPts = Math.min(22, (fatMap[lead.faturamento] || 6) + momPts);
    // 4) Origem — orgânico e indicação valem MAIS que tráfego pago (max 12)
    const srcMap = {
      indicacao: 12, instagram_organico: 11, facebook_organico: 11,
      direct: 10, stories: 9, bio_link: 9, direto: 8,
      trafego_pago: 6, outro: 5
    };
    const srcPts = srcMap[lead.source_type] || 6;
    // 5) Reuniões / calls (max 8)
    let callPts = Math.min(8, sig.appts * 5);
    if (['call_realizada', 'negociando', 'vendida'].includes(lead.pipeline_status))
      callPts = Math.max(callPts, 6);
    // 6) Recência — não sumiu (max 6)
    let recPts = 3;
    if (sig.lastTouch) {
      const days = (Date.now() - sig.lastTouch) / 86400000;
      recPts = days < 2 ? 6 : days < 7 ? 4 : days < 15 ? 2 : days < 30 ? 1 : 0;
    }
    if (sig.followups > 0) recPts = Math.min(6, recPts + 1);

    const parts = [
      { label: 'Avanço no funil', pts: funnelPts, max: 30, hint: 'O quanto o lead progrediu no pipeline' },
      { label: 'Engajamento', pts: engPts, max: 22, hint: 'Conversa iniciada, respostas e troca de mensagens' },
      { label: 'Fit de perfil', pts: fitPts, max: 22, hint: 'Capacidade de investir + clareza da dor' },
      { label: 'Origem do lead', pts: srcPts, max: 12, hint: 'Orgânico e indicação valem mais que tráfego pago' },
      { label: 'Reuniões / calls', pts: callPts, max: 8, hint: 'Calls agendadas e realizadas' },
      { label: 'Recência', pts: recPts, max: 6, hint: 'Interação recente — o lead não sumiu' }
    ];
    let total = parts.reduce((s, p) => s + p.pts, 0);
    if (lead.pipeline_status === 'perdida') total = Math.min(total, 18);
    return { parts, total: Math.max(0, Math.min(100, Math.round(total))) };
  }
  function leadScore(lead) { return leadScoreParts(lead).total; }

  // Gradiente laranja — frio = bem claro, esquentando até o quente intenso
  function scoreColor(score) {
    if (score >= 85) return '#9A2D06';
    if (score >= 65) return '#DC5A0E';
    if (score >= 45) return '#F59E42';
    if (score >= 25) return '#FBC889';
    return '#FDE2C3';
  }
  // Cor do texto sobre o selo (fundo claro pede texto escuro)
  function scoreTextColor(score) { return score >= 45 ? '#FFFFFF' : '#9A3412'; }
  // Ícones de fogo — só para leads muito quentes
  function flameCount(score) {
    return score >= 95 ? 3 : score >= 85 ? 2 : score >= 70 ? 1 : 0;
  }
  function scoreFlames(score) {
    const n = flameCount(score);
    if (!n) return '';
    let h = '<span class="score-flames" title="Lead muito quente">';
    for (let i = 0; i < n; i++)
      h += '<svg class="score-flame" viewBox="0 0 24 24"><use href="#i-flame"/></svg>';
    return h + '</span>';
  }
  function scoreInfo(lead) {
    const score = leadScore(lead);
    let label;
    if (score >= 85) label = 'Prioridade';
    else if (score >= 65) label = 'Quente';
    else if (score >= 45) label = 'Morno';
    else label = 'Frio';
    return { score, label, color: scoreColor(score),
      txt: scoreTextColor(score), hot: score >= 65, flames: scoreFlames(score) };
  }
  // Selo compacto (card / lista)
  function scoreBadge(lead) {
    const inf = scoreInfo(lead);
    return `<div class="score-badge${inf.hot ? ' hot' : ''}" style="--sc:${inf.color};--sct:${inf.txt}" title="Lead score: ${inf.score}/100 — ${inf.label}">
      <span class="score-badge-num">${inf.score}</span>
      <span class="score-badge-lb">${inf.label}</span>
      ${inf.flames}
    </div>`;
  }
  // Medidor completo com detalhamento (modal / relatório)
  function scoreGauge(lead) {
    const { parts, total } = leadScoreParts(lead);
    const inf = scoreInfo(lead);
    return `<div class="score-gauge">
      <div class="score-ring" style="--sc:${inf.color};--pct:${total}">
        <div class="score-ring-in">
          <span class="score-ring-num">${total}</span>
          <span class="score-ring-lb">${inf.label}</span>
        </div>
        ${inf.flames}
      </div>
      <div class="score-bars">
        ${parts.map(p => `<div class="score-bar-row" title="${escapeHtml(p.hint || '')}">
          <span class="score-bar-lb">${p.label}</span>
          <span class="score-bar-track"><span style="width:${Math.round(p.pts / p.max * 100)}%;background:${inf.color}"></span></span>
          <span class="score-bar-val">${p.pts}<i>/${p.max}</i></span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  // ─── Permissões ───
  function defaultPerms(role) {
    if (role === 'admin') {
      return { dashboard: true, pipeline: true, chat: true, contacts: true, tasks: true, agenda: true, automacoes: true, propostas: true, tracking: true, playbook: true, settings: true };
    }
    return { dashboard: true, pipeline: true, chat: true, contacts: true, tasks: true, agenda: true, automacoes: true, propostas: true, tracking: true, playbook: true, settings: false };
  }

  function userPerms() {
    return state.profile?.permissions || defaultPerms(state.profile?.role || 'vendedor');
  }

  function canSee(perm) {
    return !!userPerms()[perm];
  }

  // ─── DOM helpers ───
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ─── Utils ───
  function igUsername(handle) { return String(handle || '').replace(/^@/, '').trim(); }

  // Fallback chain: tenta unavatar.io (foto real IG), se não rola usa ui-avatars.com (colorido com inicial)
  // ui-avatars sempre funciona — gera SVG da inicial em cor randômica baseada no nome
  // Avatar gerado localmente (SVG data-URI) — sempre funciona, sem depender
  // de serviço externo. Cor derivada do nome.
  const AVATAR_COLORS = ['#0F766E', '#6366F1', '#DB2777', '#EA580C', '#2563EB', '#9333EA', '#16A34A', '#CA8A04'];
  function localAvatar(nome) {
    const ini = initials(nome);
    const s = String(nome || '?');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const bg = AVATAR_COLORS[h % AVATAR_COLORS.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">` +
      `<rect width="80" height="80" rx="40" fill="${bg}"/>` +
      `<text x="40" y="40" dy="0.35em" text-anchor="middle" font-family="Inter,Arial,sans-serif" ` +
      `font-size="32" font-weight="700" fill="#ffffff">${ini}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  // Foto do perfil do Instagram (via unavatar.io). fallback=false → 404 quando
  // não acha, para o onerror cair no avatar local colorido.
  function igPhoto(handle) {
    const u = igUsername(handle);
    return u ? 'https://unavatar.io/instagram/' + encodeURIComponent(u) + '?fallback=false' : null;
  }
  // Avatar do lead: tenta a foto real do Instagram, senão o avatar local.
  function avatarUrl(handle, nome) {
    return igPhoto(handle) || localAvatar(nome || handle);
  }
  // Valor para o atributo onerror — cai no avatar local (SVG colorido).
  // O data-URI do localAvatar não tem aspas, então é seguro embutir inline.
  function avatarFallback(nome) {
    return "this.onerror=null;this.src='" + localAvatar(nome) + "'";
  }
  function phoneDigits(phone) { return String(phone || '').replace(/\D/g, ''); }
  function whatsappLink(phone, fname) {
    const d = phoneDigits(phone); if (!d) return '#';
    const txt = fname
      ? `Oi ${fname}, aqui é da equipe MyLion. Vi o seu diagnóstico e queria conversar.`
      : 'Oi! Aqui é da equipe MyLion.';
    return `https://wa.me/${d}?text=${encodeURIComponent(txt)}`;
  }
  function instagramLink(handle) { const u = igUsername(handle); return u ? `https://instagram.com/${u}` : '#'; }
  function reportLink(lead) {
    return lead.report_link || `${CONFIG.REPORT_BASE_URL}?id=${lead.id}`;
  }
  // Avatar de um usuário/profile: usa avatar_url (foto enviada) se houver,
  // senão cai pro avatar gerado pela inicial
  function profileAvatar(profile) {
    if (profile && profile.avatar_url) return profile.avatar_url;
    const nome = profile ? (profile.nome || profile.email) : '';
    return avatarUrl(null, nome);
  }
  function firstName(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
  function initials(nome) {
    const p = String(nome || '').trim().split(/\s+/);
    if (!p[0]) return '?';
    if (p.length === 1) return p[0].charAt(0).toUpperCase();
    return (p[0].charAt(0) + p[p.length - 1].charAt(0)).toUpperCase();
  }
  function relativeTime(d) {
    if (!d) return '';
    const ms = Date.now() - new Date(d).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}sem`;
    return `${Math.floor(days / 30)}m`;
  }
  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function isAdmin() { return state.profile?.role === 'admin'; }
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, type) {
    const el = $('toast'); el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.className = 'toast', 3000);
  }
  function topsToList(lead) { return [lead.top1, lead.top2, lead.top3].filter(Boolean); }

  // Resumo interpretativo do lead, gerado a partir dos dados do diagnóstico.
  function buildLeadSummary(lead) {
    const nome = firstName(lead.nome) || 'Este lead';
    const inf = scoreInfo(lead);
    const scoreTxt = {
      'Prioridade': 'lead de PRIORIDADE — contato imediato',
      'Quente': 'um lead quente — priorize a abordagem',
      'Morno': 'um lead morno — precisa de mais nutrição antes de avançar',
      'Frio': 'um lead frio — baixa prioridade neste momento'
    }[inf.label] || 'um lead a ser avaliado';
    const parts = [`${nome} tem lead score ${inf.score}/100 — ${scoreTxt}.`];
    if (lead.faturamento) {
      const low = /Até R\$ 5/.test(lead.faturamento);
      const high = /Acima/.test(lead.faturamento);
      parts.push(`Fatura ${lead.faturamento.toLowerCase()}` +
        (low ? ' — orçamento mais apertado, ancore bem o valor na conversa.'
          : high ? ' — bom poder de investimento.'
            : ' — está na faixa ideal de investimento.'));
    }
    if (lead.momento) parts.push(`Momento do diagnóstico: ${lead.momento}.`);
    if (lead.nota_geral != null) {
      const n = Number(lead.nota_geral);
      parts.push(`Nota geral de ${n.toFixed(2).replace('.', ',')}/5` +
        (n < 2.5 ? ' — indica clareza grande da dor, ótimo para abordar agora.' : '.'));
    }
    const tops = topsToList(lead);
    if (tops.length) parts.push(`Pontos mais críticos: ${tops.join('; ')}. Conduza a conversa por aí.`);
    return parts.join(' ');
  }
  function findStage(id) {
    return state.pipeline.find(s => s.id === id) || { id: id, label: id, color: '#94A3B8' };
  }
  function profileById(id) {
    return state.profiles.find(p => p.id === id);
  }
  // Nome de exibição de um profile — nunca o email completo
  function profileName(p) {
    return (p && (p.nome || (p.email || '').split('@')[0])) || '—';
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════
  async function tryRestoreSession() {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      state.user = data.session.user;
      await loadProfile();
      showApp();
    } else showLogin();
  }

  async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    state.profile = data || { id: state.user.id, email: state.user.email, role: 'vendedor' };
    // Merge permissões com defaults — cobre chaves novas (ex: 'chat') em profiles
    // criados antes de uma migration que adicionou novas permissões
    const defaults = defaultPerms(state.profile.role);
    state.profile.permissions = { ...defaults, ...(state.profile.permissions || {}) };
  }

  async function login(email, password) {
    $('login-error').classList.remove('show');
    $('login-btn').disabled = true; $('login-btn').textContent = 'Entrando...';
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user;
      await loadProfile();
      showApp();
    } catch (err) {
      $('login-error').textContent = err.message || 'Não foi possível entrar.';
      $('login-error').classList.add('show');
    } finally {
      $('login-btn').disabled = false; $('login-btn').textContent = 'Entrar';
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    Object.assign(state, { user: null, profile: null, leads: [] });
    teardownSortables();
    closeAllModals();
    showLogin();
  }

  function showLogin() {
    $('login-screen').style.display = 'flex';
    $('app').classList.remove('show');
  }

  async function showApp() {
    $('login-screen').style.display = 'none';
    $('app').classList.add('show');

    // User menu (topbar)
    const displayName = state.profile.nome || state.profile.email.split('@')[0];
    $('user-name').textContent = displayName;
    $('user-email').textContent = state.profile.email;
    $('user-role').textContent = state.profile.role;
    if ($('user-dropdown-name')) $('user-dropdown-name').textContent = displayName;

    // Avatares do usuário (topbar + dropdown)
    const userAv = profileAvatar(state.profile);
    ['topbar-user-avatar', 'user-dropdown-avatar'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = `<img src="${userAv}" alt="" onerror="this.parentElement.textContent='${initials(displayName)}'">`;
    });

    // Aplica permissões: esconde abas que o user não pode ver
    applyNavPermissions();

    // Carrega projetos e decide qual abrir
    await loadProjects();
    const saved = localStorage.getItem('crm_project');
    if (saved && state.projects.find(p => p.id === saved)) {
      state.projectId = saved;
      bootProjectData();
    } else if (state.projects.length === 1) {
      state.projectId = state.projects[0].id;
      localStorage.setItem('crm_project', state.projectId);
      bootProjectData();
    } else {
      showProjectPicker();
    }
  }

  // Carrega todos os dados do projeto selecionado e renderiza o app
  function bootProjectData() {
    localStorage.setItem('crm_project', state.projectId);
    renderProjectSwitch();
    Promise.all([loadPipeline(), loadProfiles(), loadLeads(), loadConversations(), loadTasks(), loadAppointments(), loadScheduledMessages(), loadNotifications(), loadAutomations(), loadProposals()]).then(() => {
      renderAll();
      renderNotifications();
      subscribeRealtime();
      const hv = (location.hash || '').replace('#', '');
      const hvBtn = hv && document.querySelector('.nav-item[data-view="' + hv + '"]');
      if (hvBtn && hvBtn.style.display !== 'none') switchView(hv);
      else ensureValidView();
      handleGoogleOAuthReturn();
      refreshGoogleStatus();
    });
  }

  // ─── Projetos (multi-projeto) ───
  async function loadProjects() {
    const { data, error } = await supabase.from('projects')
      .select('*').order('created_at', { ascending: true });
    if (error) { console.warn('Projects falhou', error); state.projects = []; return; }
    state.projects = data || [];
  }
  function currentProject() {
    return state.projects.find(p => p.id === state.projectId) || null;
  }
  function showProjectPicker() {
    const pk = $('project-picker');
    if (!pk) return;
    $('project-picker-list').innerHTML = state.projects.map(p => `
      <button class="project-pick-card" data-pick="${p.id}" style="--pc:${p.color || '#0F766E'}">
        <span class="project-pick-dot"></span>
        <span class="project-pick-name">${escapeHtml(p.name)}</span>
        <span class="project-pick-go">Abrir →</span>
      </button>`).join('') ||
      '<div style="color:var(--text-muted);font-size:13px">Nenhum projeto cadastrado.</div>';
    pk.querySelectorAll('[data-pick]').forEach(b => {
      b.addEventListener('click', () => {
        state.projectId = b.dataset.pick;
        pk.classList.remove('show');
        bootProjectData();
      });
    });
    pk.classList.add('show');
  }
  function renderProjectSwitch() {
    const cur = currentProject();
    const btn = $('project-current');
    const dot = $('project-dot');
    if (btn) btn.textContent = cur ? cur.name : 'Projeto';
    if (dot && cur) dot.style.background = cur.color || '#0F766E';
    const menu = $('project-menu');
    if (menu) {
      menu.innerHTML = state.projects.map(p => `
        <button class="project-menu-item ${p.id === state.projectId ? 'active' : ''}" data-proj="${p.id}">
          <span class="project-menu-dot" style="background:${p.color || '#0F766E'}"></span>
          ${escapeHtml(p.name)}
        </button>`).join('');
      menu.querySelectorAll('[data-proj]').forEach(b => {
        b.addEventListener('click', () => {
          $('project-switch').classList.remove('open');
          if (b.dataset.proj !== state.projectId) switchProject(b.dataset.proj);
        });
      });
    }
  }
  function switchProject(id) {
    state.projectId = id;
    localStorage.setItem('crm_project', id);
    // limpa caches do projeto anterior
    state.messages = {};
    state.activeConversationId = null;
    state.leadHistory = {};
    bootProjectData();
    toast('Projeto: ' + (currentProject() ? currentProject().name : ''), 'success');
  }

  function applyNavPermissions() {
    $$('.nav-item').forEach(btn => {
      const perm = btn.dataset.perm;
      if (!perm) return;
      btn.style.display = canSee(perm) ? '' : 'none';
    });
  }

  function ensureValidView() {
    if (!canSee(state.currentView)) {
      const fallback = ['dashboard', 'pipeline', 'contacts', 'tracking', 'settings']
        .find(v => canSee(v === 'pipeline' ? 'pipeline' : v));
      // map de view name pra permission
      const order = ['dashboard', 'pipeline', 'contacts', 'tasks', 'agenda', 'automacoes', 'propostas', 'tracking', 'playbook', 'settings'];
      const perms = ['dashboard', 'pipeline', 'contacts', 'tasks', 'agenda', 'automacoes', 'propostas', 'tracking', 'playbook', 'settings'];
      for (let i = 0; i < order.length; i++) {
        if (canSee(perms[i])) {
          // converter pipeline → kanban (view ID)
          switchView(order[i] === 'pipeline' ? 'kanban' : order[i]);
          return;
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA: pipeline_config, profiles, leads
  // ═══════════════════════════════════════════════════════════════════
  async function loadPipeline() {
    const { data, error } = await supabase.from('pipeline_config')
      .select('columns').eq('project_id', state.projectId).maybeSingle();
    if (error || !data) {
      console.warn('Pipeline config falhou, usando default', error);
      state.pipeline = defaultPipeline();
    } else {
      state.pipeline = (data.columns || []).slice().sort((a, b) => a.order - b.order);
    }
  }

  function defaultPipeline() {
    return [
      { id: 'lead_criado',    label: 'Lead criado',    color: '#A5B4FC', order: 0 },
      { id: 'agendou',        label: 'Agendou',        color: '#FDBA74', order: 1 },
      { id: 'call_realizada', label: 'Call realizada', color: '#86EFAC', order: 2 },
      { id: 'no_show',        label: 'No show',        color: '#D4D4D8', order: 3 },
      { id: 'negociando',     label: 'Negociando',     color: '#FCD34D', order: 4 },
      { id: 'vendida',        label: 'Vendida',        color: '#34D399', order: 5 },
      { id: 'perdida',        label: 'Perdida',        color: '#FCA5A5', order: 6 }
    ];
  }

  async function savePipeline(columns) {
    const { error } = await supabase.from('pipeline_config')
      .update({ columns, updated_at: new Date().toISOString(), updated_by: state.user.id })
      .eq('project_id', state.projectId);
    if (error) { toast('Erro: ' + error.message, 'error'); return false; }
    state.pipeline = columns;
    toast('Pipeline salvo', 'success');
    renderAll();
    return true;
  }

  async function loadProfiles() {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
    if (error) { console.warn('Profiles falhou', error); return; }
    state.profiles = data || [];
  }

  async function loadLeads() {
    const { data, error } = await supabase.from('leads').select('*')
      .eq('project_id', state.projectId).order('created_at', { ascending: false });
    if (error) { toast('Erro ao carregar: ' + error.message, 'error'); return; }
    state.leads = data || [];
  }

  async function updateLead(id, patch) {
    const lead = state.leads.find(l => l.id === id);
    const previous = lead ? { ...lead } : null;
    if (lead) Object.assign(lead, patch);
    renderAll();

    const { error } = await supabase.from('leads').update({ ...patch, atualizado_por: state.user.id }).eq('id', id);
    if (error) {
      if (lead && previous) Object.assign(lead, previous);
      renderAll();
      toast('Erro: ' + error.message, 'error');
      return false;
    }
    return true;
  }

  async function deleteLead(id) {
    if (!confirm('Deletar este lead permanentemente? Esta ação não pode ser desfeita.')) return;
    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.leads = state.leads.filter(l => l.id !== id);
    closeAllModals();
    renderAll();
    toast('Lead deletado', 'success');
  }

  // Resumo: chama Edge Function, faz cache na coluna instagram_summary
  async function ensureSummary(lead) {
    if (lead.instagram_summary) return lead.instagram_summary;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(CONFIG.SUPABASE_URL + CONFIG.SUMMARY_FUNCTION_PATH, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lead_id: lead.id })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.summary) {
        lead.instagram_summary = json.summary;
        return json.summary;
      }
      return null;
    } catch (err) {
      console.warn('Summary falhou:', err);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // REALTIME
  // ═══════════════════════════════════════════════════════════════════
  let realtimeChannel = null;
  function subscribeRealtime() {
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    realtimeChannel = supabase.channel('crm-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, payload => {
        if (payload.eventType === 'INSERT') {
          if (payload.new.project_id === state.projectId &&
              !state.leads.find(l => l.id === payload.new.id)) {
            state.leads.unshift(payload.new);
            renderAll();
            toast(`Novo lead: ${payload.new.nome}`, 'success');
          }
        } else if (payload.eventType === 'UPDATE') {
          const i = state.leads.findIndex(l => l.id === payload.new.id);
          if (i >= 0) { state.leads[i] = payload.new; renderAll(); }
        } else if (payload.eventType === 'DELETE') {
          state.leads = state.leads.filter(l => l.id !== payload.old.id);
          renderAll();
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_config' }, async () => {
        await loadPipeline(); renderAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
        await loadTasks();
        if (state.currentView === 'tasks') renderTasks();
        else renderTaskDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, async () => {
        await loadAppointments();
        if (state.currentView === 'agenda') renderAgenda();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_messages' }, async () => {
        await loadScheduledMessages();
        if (state.currentView === 'automacoes') renderSchedMsgList();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automations' }, async () => {
        await loadAutomations();
        if (state.currentView === 'automacoes' && state.auto2Tab === 'custom') renderAutoTable();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, async () => {
        await loadProposals();
        if (state.currentView === 'propostas') renderPropostas();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, async (payload) => {
        await loadNotifications();
        renderNotifications();
        if (payload.eventType === 'INSERT' && payload.new && !payload.new.read) {
          toast('🔔 ' + payload.new.title, 'success');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async () => {
        await loadProfiles();
        if (state.currentView === 'settings') renderVendors();
        renderAll();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, async (payload) => {
        // Recarrega lista de conversations (mais simples que sync seletivo por causa do join com leads)
        await loadConversations();
        if (state.currentView === 'chat') renderChat();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const m = payload.new;
          // Adiciona ao cache da conversa
          if (!state.messages[m.conversation_id]) state.messages[m.conversation_id] = [];
          if (!state.messages[m.conversation_id].find(x => x.id === m.id)) {
            state.messages[m.conversation_id].push(m);
          }
          // Toast pra nova mensagem inbound se não estiver na conversa
          if (m.direction === 'in' && state.activeConversationId !== m.conversation_id) {
            const conv = state.conversations.find(c => c.id === m.conversation_id);
            const lead = conv?.leads || {};
            toast(`💬 ${lead.nome || 'Lead'}: ${(m.content || '[mídia]').slice(0, 40)}`, 'success');
          }
          if (state.currentView === 'chat' && state.activeConversationId === m.conversation_id) {
            renderChatThread();
          }
        } else if (payload.eventType === 'UPDATE') {
          const m = payload.new;
          const arr = state.messages[m.conversation_id];
          if (arr) {
            const idx = arr.findIndex(x => x.id === m.id);
            if (idx >= 0) arr[idx] = m;
            if (state.currentView === 'chat' && state.activeConversationId === m.conversation_id) {
              renderChatThread();
            }
          }
        }
      })
      .subscribe();
  }

  // ═══════════════════════════════════════════════════════════════════
  // VIEW ROUTING
  // ═══════════════════════════════════════════════════════════════════
  function switchView(name) {
    state.currentView = name;
    // Reflete a view atual no endereço (sobrevive ao recarregar a página)
    if (location.hash.replace('#', '') !== name) location.hash = name;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));

    const titles = {
      dashboard: 'Dashboard',
      kanban: 'Pipeline',
      chat: 'Chat',
      contacts: 'Contatos',
      tasks: 'Tarefas',
      agenda: 'Agenda',
      automacoes: 'Automações',
      propostas: 'Propostas',
      tracking: 'Traqueamento',
      playbook: 'Playbook',
      settings: 'Configurações'
    };
    $('topbar-title').textContent = titles[name] || name;

    // Toolbar de filtros aparece em kanban e contacts
    $('toolbar').style.display = (name === 'kanban' || name === 'contacts') ? '' : 'none';

    if (name === 'dashboard')  renderMetrics();
    if (name === 'contacts')   renderContacts();
    if (name === 'tasks')      renderTasks();
    if (name === 'agenda')     renderAgenda();
    if (name === 'automacoes') renderAutomacoes();
    if (name === 'propostas')  renderPropostas();
    if (name === 'tracking')   renderTracking();
    if (name === 'playbook')   renderPlaybook();
    if (name === 'settings')  renderSettings();
    if (name === 'chat')      renderChat();
  }

  // ═══════════════════════════════════════════════════════════════════
  // FILTROS + BUSCA
  // ═══════════════════════════════════════════════════════════════════
  function applyFilters() {
    let result = state.leads.slice();

    // Busca
    const term = state.searchTerm.toLowerCase().trim();
    if (term) {
      result = result.filter(l =>
        (l.nome || '').toLowerCase().includes(term) ||
        (l.instagram || '').toLowerCase().includes(term) ||
        (l.telefone || '').toLowerCase().includes(term) ||
        (l.momento || '').toLowerCase().includes(term)
      );
    }

    // Vendedor
    if (state.filters.vendor === 'me') {
      result = result.filter(l => l.assigned_to === state.user.id);
    } else if (state.filters.vendor === 'unassigned') {
      result = result.filter(l => !l.assigned_to);
    } else if (state.filters.vendor) {
      result = result.filter(l => l.assigned_to === state.filters.vendor);
    }

    // Faturamento
    if (state.filters.revenue) {
      result = result.filter(l => l.faturamento === state.filters.revenue);
    }

    // Período
    if (state.filters.period) {
      const now = Date.now();
      const periods = { today: 1, week: 7, month: 30 };
      const days = periods[state.filters.period];
      if (days) {
        const cutoff = now - days * 24 * 60 * 60 * 1000;
        result = result.filter(l => new Date(l.created_at).getTime() > cutoff);
      }
    }

    state.filtered = result;
  }

  function updateFilterUI() {
    // Atualiza select de vendor com profiles
    const sel = $('filter-vendor');
    const currentVal = sel.value;
    sel.innerHTML = `
      <option value="">Todos vendedores</option>
      <option value="me">Meus leads</option>
      <option value="unassigned">Não atribuídos</option>
      ${state.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.nome || p.email.split('@')[0])}</option>`).join('')}
    `;
    sel.value = currentVal;
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  function renderAll() {
    applyFilters();
    updateFilterUI();
    renderStats();
    renderKanban();
    if (state.currentView === 'contacts') renderContacts();
    if (state.currentView === 'dashboard') renderMetrics();
    if (state.currentView === 'tracking') renderTracking();
    if (state.currentView === 'tasks') renderTasks();
    else renderTaskDashboard();
  }

  function renderStats() {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const wk = state.leads.filter(l => new Date(l.created_at).getTime() > weekAgo).length;
    const sold = state.leads.filter(l => l.pipeline_status === 'vendida').length;
    $('stat-total').textContent = state.leads.length;
    $('stat-week').textContent = wk;
    $('stat-vendida').textContent = sold;
    $('nav-badge-kanban').textContent = state.leads.length;
    $('nav-badge-contacts').textContent = state.leads.length;
  }

  // ─── KANBAN ───
  function renderKanban() {
    const k = $('kanban');
    k.innerHTML = state.pipeline.map(stage => `
      <div class="column" style="--col-color:${stage.color}" data-status="${stage.id}">
        <header class="column-head">
          <span class="column-dot"></span>
          <span class="column-title">${escapeHtml(stage.label)}</span>
          <span class="column-count" data-count="${stage.id}">0</span>
        </header>
        <div class="column-body" data-status="${stage.id}"></div>
      </div>
    `).join('');

    state.pipeline.forEach(stage => {
      const body = k.querySelector(`.column-body[data-status="${stage.id}"]`);
      const count = k.querySelector(`[data-count="${stage.id}"]`);
      const leads = state.filtered.filter(l => l.pipeline_status === stage.id);
      count.textContent = leads.length;
      body.innerHTML = leads.length
        ? leads.map(l => cardHTML(l, stage)).join('')
        : '<div class="empty-col">Sem leads aqui</div>';
    });

    setupSortables();
  }

  // Fileira de 5 bolinhas representando a temperatura/interesse do lead
  function cardDots(temp) {
    const colors = ['#FB7185', '#FB923C', '#FACC15', '#A3E635', '#34D399'];
    let h = '';
    for (let i = 0; i < 5; i++) {
      h += `<span class="card-dot"${i < temp ? ` style="background:${colors[i]}"` : ''}></span>`;
    }
    return `<div class="card-dots">${h}</div>`;
  }

  function cardHTML(lead, stage) {
    const handle = lead.instagram || '';
    const fname = firstName(lead.nome);
    const avatar = avatarUrl(handle, lead.nome);
    const assignedP = lead.assigned_to ? profileById(lead.assigned_to) : null;
    const assignedChip = assignedP
      ? `<span class="chip chip-accent" title="Vendedor: ${escapeHtml(profileName(assignedP))}">👤 ${escapeHtml(firstName(assignedP.nome) || profileName(assignedP))}</span>`
      : '';
    const sm = lead.source_type ? sourceMeta(lead.source_type) : null;
    const sourceChip = sm
      ? `<span class="chip chip-source" data-src="${lead.source_type}" title="${escapeHtml(sm.label)}">${sm.icon} ${escapeHtml(sm.label)}</span>`
      : '<span class="card-bottom-empty">Sem origem</span>';

    return `
      <div class="card" data-lead-id="${lead.id}">
        <div class="card-top">
          <div class="card-avatar">
            <img src="${avatar}" alt="" onerror="${avatarFallback(lead.nome)}">
          </div>
          <div class="card-identity">
            <div class="card-name">${escapeHtml(lead.nome)}</div>
            <div class="card-role">${escapeHtml(handle || lead.momento || '—')}</div>
          </div>
          <span class="card-open" title="Abrir lead"><svg><use href="#i-expand"/></svg></span>
        </div>
        <div class="card-tags">
          ${lead.momento ? `<span class="chip">${escapeHtml(lead.momento)}</span>` : ''}
          ${lead.nota_geral != null ? `<span class="chip chip-score">${Number(lead.nota_geral).toFixed(1).replace('.', ',')}/5</span>` : ''}
          ${assignedChip}
        </div>
        <div class="card-bottom">
          <div class="card-bottom-col">
            <div class="card-bottom-lb">Origem</div>
            ${sourceChip}
          </div>
          <div class="card-bottom-col card-bottom-right">
            <div class="card-bottom-lb">Lead score</div>
            ${scoreBadge(lead)}
          </div>
        </div>
        <div class="card-footer">
          <a class="card-btn wa" href="${whatsappLink(lead.telefone, fname)}" target="_blank" onclick="event.stopPropagation()" title="WhatsApp">
            <svg><use href="#i-wa"/></svg>
          </a>
          <a class="card-btn ig" href="${instagramLink(handle)}" target="_blank" onclick="event.stopPropagation()" title="Instagram">
            <svg><use href="#i-ig"/></svg>
          </a>
          <button class="card-btn report" data-report-id="${lead.id}" title="Ver relatório" type="button">
            <svg><use href="#i-report"/></svg>
          </button>
          <span class="card-time">${relativeTime(lead.created_at)}</span>
        </div>
      </div>
    `;
  }

  function teardownSortables() {
    state.sortables.forEach(s => { try { s.destroy(); } catch(e){} });
    state.sortables = [];
  }

  function setupSortables() {
    teardownSortables();
    $$('.column-body').forEach(col => {
      const s = new Sortable(col, {
        group: 'pipeline',
        animation: 180,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        onEnd: async (evt) => {
          const id = evt.item.dataset.leadId;
          const ns = evt.to.dataset.status;
          const os = evt.from.dataset.status;
          if (ns !== os) await updateLead(id, { pipeline_status: ns });
        }
      });
      state.sortables.push(s);
    });

    // Click no card abre modal
    $$('.card').forEach(c => {
      c.addEventListener('click', e => {
        if (e.target.closest('a') || e.target.closest('button')) return;
        openLeadModal(c.dataset.leadId);
      });
    });

    // Botão de relatório no card
    $$('[data-report-id]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const lead = state.leads.find(l => l.id === b.dataset.reportId);
        if (lead) openReportModal(lead);
      });
    });

    // Lazy load summaries
    $$('[data-needs-summary]').forEach(el => {
      const id = el.dataset.needsSummary;
      const lead = state.leads.find(l => l.id === id);
      if (!lead) return;
      ensureSummary(lead).then(summary => {
        if (summary && state.currentView === 'kanban') {
          renderKanban();
        }
      });
    });
  }

  // ─── CONTATOS ───
  function renderContacts() {
    const tbody = $('contacts-tbody');
    const cnt = $('contacts-count');
    if (cnt) cnt.textContent = `${state.filtered.length} ${state.filtered.length === 1 ? 'contato' : 'contatos'}`;
    if (state.filtered.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="8">
          <div class="empty-state">
            <div class="empty-state-title">Nenhum contato encontrado</div>
            <div class="empty-state-text">Ajuste os filtros ou cadastre um contato manualmente em "Novo contato".</div>
          </div>
        </td></tr>`;
      return;
    }
    tbody.innerHTML = state.filtered.map(l => {
      const stage = findStage(l.pipeline_status);
      const av = avatarUrl(l.instagram, l.nome);
      const assigned = l.assigned_to ? profileById(l.assigned_to) : null;
      const fname = firstName(l.nome);
      const isClient = l.pipeline_status === 'vendida';
      return `
        <tr data-lead-id="${l.id}" class="${isClient ? 'contact-client' : ''}">
          <td>
            <div class="contact-name-cell">
              <div class="contact-avatar">
                <img src="${av}" alt="" onerror="${avatarFallback(l.nome)}">
              </div>
              <div>
                <div class="contact-name-text">${escapeHtml(l.nome || '—')}${isClient ? '<span class="contact-client-tag">Cliente</span>' : ''}</div>
                <div class="contact-handle">${escapeHtml(l.instagram || l.empresa || l.email || '')}</div>
              </div>
            </div>
          </td>
          <td><a href="${whatsappLink(l.telefone, fname)}" target="_blank" style="color:var(--accent)">${escapeHtml(l.telefone || '—')}</a></td>
          <td>${escapeHtml(l.faturamento || '—')}</td>
          <td>${scoreBadge(l)}</td>
          <td><span class="chip" style="background:${stage.color}33; color:#1A1A18">${escapeHtml(stage.label)}</span></td>
          <td>${assigned ? escapeHtml(profileName(assigned)) : '<span style="color:var(--text-faded)">—</span>'}</td>
          <td style="color:var(--text-muted)">${relativeTime(l.created_at)}</td>
          <td>
            <div class="row-actions" style="justify-content:flex-end">
              <button class="row-action" data-action="view" title="Ver"><svg><use href="#i-search"/></svg></button>
              <button class="row-action" data-action="edit" title="Editar"><svg><use href="#i-edit"/></svg></button>
              ${isAdmin() ? `<button class="row-action danger" data-action="delete" title="Deletar"><svg><use href="#i-trash"/></svg></button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Wire row actions
    tbody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('tr').dataset.leadId;
        const action = btn.dataset.action;
        if (action === 'view') openLeadModal(id);
        if (action === 'edit') openContactModal(id);
        if (action === 'delete') deleteLead(id);
      });
    });

    // Click na linha abre modal
    tbody.querySelectorAll('tr[data-lead-id]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        openLeadModal(tr.dataset.leadId);
      });
    });
  }

  // ─── MÉTRICAS ───
  // ─── DASHBOARD: escopo filtrado + helpers de moeda ───
  function dashLeads() {
    let r = state.leads.slice();
    const df = state.dashFilter;
    if (df.vendor === 'unassigned') r = r.filter(l => !l.assigned_to);
    else if (df.vendor) r = r.filter(l => l.assigned_to === df.vendor);
    if (df.source) r = r.filter(l => (l.source_type || 'outro') === df.source);
    if (df.period) {
      const days = { today: 1, week: 7, month: 30, quarter: 90 }[df.period];
      if (days) {
        const cut = Date.now() - days * 86400000;
        r = r.filter(l => new Date(l.created_at).getTime() > cut);
      }
    }
    return r;
  }
  function brl(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function brlShort(n) {
    n = Number(n || 0);
    if (n >= 1000000) return 'R$ ' + (n / 1000000).toFixed(1).replace('.', ',') + 'M';
    if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(1).replace('.', ',') + 'k';
    return brl(n);
  }
  function updateDashFilterUI() {
    const vsel = $('dash-vendor');
    if (vsel) {
      vsel.innerHTML = '<option value="">Todos vendedores</option>' +
        '<option value="unassigned">Não atribuídos</option>' +
        state.profiles.map(p => `<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
      vsel.value = state.dashFilter.vendor;
    }
    const ssel = $('dash-source');
    if (ssel) {
      const srcs = [...new Set(state.leads.map(l => l.source_type || 'outro'))];
      ssel.innerHTML = '<option value="">Todas as origens</option>' +
        srcs.map(s => `<option value="${s}">${escapeHtml(sourceMeta(s).label)}</option>`).join('');
      ssel.value = state.dashFilter.source;
    }
    const psel = $('dash-period');
    if (psel) psel.value = state.dashFilter.period;
  }

  function renderMetrics() {
    updateDashFilterUI();
    const leads = dashLeads();
    const total = leads.length;
    const weekAgo = Date.now() - 7 * 86400000;
    const prevWeekAgo = Date.now() - 14 * 86400000;
    const wk = leads.filter(l => new Date(l.created_at).getTime() > weekAgo).length;
    const prevWk = leads.filter(l => {
      const t = new Date(l.created_at).getTime();
      return t > prevWeekAgo && t <= weekAgo;
    }).length;
    const sold = leads.filter(l => l.pipeline_status === 'vendida').length;
    const conv = total > 0 ? Math.round((sold / total) * 100) : 0;
    const hot = leads.filter(l => leadScore(l) >= 65).length;
    const unassigned = leads.filter(l => !l.assigned_to).length;

    $('m-total').textContent = total;
    $('m-week').textContent = wk;
    $('m-vendida').textContent = sold;
    $('m-conv').textContent = conv;
    if ($('m-hot')) $('m-hot').textContent = hot;
    if ($('m-unassigned')) $('m-unassigned').textContent = unassigned;

    const delta = wk - prevWk;
    const deltaEl = $('m-week-delta');
    if (prevWk === 0 && wk === 0) {
      deltaEl.textContent = '';
      deltaEl.className = 'metric-delta flat';
    } else if (delta > 0) {
      deltaEl.innerHTML = `<svg width="11" height="11"><use href="#i-arrow-up"/></svg> +${delta} vs. semana anterior`;
      deltaEl.className = 'metric-delta up';
    } else if (delta < 0) {
      deltaEl.innerHTML = `<svg width="11" height="11"><use href="#i-arrow-down"/></svg> ${delta} vs. semana anterior`;
      deltaEl.className = 'metric-delta down';
    } else {
      deltaEl.textContent = '= vs. semana anterior';
      deltaEl.className = 'metric-delta flat';
    }

    renderKpiGrid(leads);
    renderFunnel();
    renderTimelineChart();
    renderLeaderboard();
    renderSourcePerf(leads);
    renderRevenueChart();
  }

  // KPIs comerciais avançados — performance da operação
  function renderKpiGrid(leads) {
    const el = $('kpi-grid');
    if (!el) return;
    const ids = leads.map(l => l.id);
    const inSet = id => ids.includes(id);
    const isLost = l => state.pipeline.some(s => s.id === l.pipeline_status && isLossStage(s));
    const closedWon = leads.filter(l => l.pipeline_status === 'vendida');
    const closedLost = leads.filter(isLost);
    const open = leads.filter(l => l.pipeline_status !== 'vendida' && !isLost(l));
    const stalled = open.filter(l => {
      const sig = leadSignals(l);
      return sig.lastTouch && (Date.now() - sig.lastTouch) > 7 * 86400000;
    });
    const reachedStage = key => leads.filter(l => {
      const o = state.pipeline.find(s => s.id === l.pipeline_status);
      const target = state.pipeline.find(s => s.id === key);
      return o && target && o.order >= target.order && !isLost(l);
    }).length;
    const agendou = reachedStage('agendou');
    const realizou = reachedStage('call_realizada');
    const attendRate = agendou > 0 ? Math.round(realizou / agendou * 100) : 0;
    const negoc = leads.filter(l => l.pipeline_status === 'negociando').length;
    const closeRate = realizou > 0 ? Math.round(closedWon.length / realizou * 100) : 0;
    const revenue = closedWon.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const ticket = closedWon.length > 0 ? revenue / closedWon.length : 0;
    const forecast = leads.filter(l => l.pipeline_status === 'negociando')
      .reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const convs = state.conversations.filter(c => inSet(c.lead_id));
    const replied = convs.filter(c => c.last_inbound_at).length;
    const respRate = convs.length > 0 ? Math.round(replied / convs.length * 100) : 0;
    const waiting = convs.filter(c => c.last_message_direction === 'in' && (c.unread_count || 0) > 0).length;
    const fus = state.tasks.filter(t => t.lead_id && inSet(t.lead_id));
    const fuDone = fus.filter(t => t.done).length;
    const fuPend = fus.filter(t => !t.done).length;
    const scoreAvg = leads.length ? Math.round(leads.reduce((s, l) => s + leadScore(l), 0) / leads.length) : 0;

    const kpis = [
      { ic: '🌱', lb: 'Leads novos (7d)', v: leads.filter(l => new Date(l.created_at).getTime() > weekAgoMs()).length },
      { ic: '🔄', lb: 'Em andamento', v: open.length },
      { ic: '🏆', lb: 'Ganhos', v: closedWon.length, tone: 'good' },
      { ic: '💔', lb: 'Perdidos', v: closedLost.length, tone: 'bad' },
      { ic: '🧊', lb: 'Parados (+7d)', v: stalled.length, tone: stalled.length ? 'warn' : '' },
      { ic: '📅', lb: 'Calls agendadas', v: agendou },
      { ic: '✅', lb: 'Calls realizadas', v: realizou },
      { ic: '🚪', lb: 'Comparecimento', v: attendRate + '%' },
      { ic: '🤝', lb: 'Em negociação', v: negoc },
      { ic: '🎯', lb: 'Taxa de fechamento', v: closeRate + '%', tone: 'good' },
      { ic: '💰', lb: 'Receita gerada', v: brlShort(revenue), tone: 'good' },
      { ic: '🧾', lb: 'Ticket médio', v: brlShort(ticket) },
      { ic: '📈', lb: 'Receita prevista', v: brlShort(forecast), sub: 'em negociação' },
      { ic: '💬', lb: 'Conversas ativas', v: convs.length },
      { ic: '↩️', lb: 'Taxa de resposta', v: respRate + '%' },
      { ic: '⏳', lb: 'Aguardando retorno', v: waiting, tone: waiting ? 'warn' : '' },
      { ic: '📋', lb: 'Follow-ups pendentes', v: fuPend, tone: fuPend ? 'warn' : '' },
      { ic: '☑️', lb: 'Follow-ups feitos', v: fuDone },
      { ic: '🔥', lb: 'Lead score médio', v: scoreAvg + '/100' },
      { ic: '🎟️', lb: 'Conversão geral', v: (total => total > 0 ? Math.round(closedWon.length / total * 100) : 0)(leads.length) + '%' }
    ];
    el.innerHTML = kpis.map(k => `
      <div class="kpi-card ${k.tone ? 'kpi-' + k.tone : ''}">
        <span class="kpi-ic">${k.ic}</span>
        <div class="kpi-body">
          <div class="kpi-val">${k.v}</div>
          <div class="kpi-lb">${k.lb}</div>
          ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
        </div>
      </div>`).join('');
  }
  function weekAgoMs() { return Date.now() - 7 * 86400000; }

  // Origem dos leads — conversão por canal
  function renderSourcePerf(leads) {
    const el = $('source-perf');
    if (!el) return;
    const groups = {};
    leads.forEach(l => {
      const k = l.source_type || 'outro';
      (groups[k] = groups[k] || []).push(l);
    });
    const rows = Object.entries(groups).map(([k, arr]) => {
      const won = arr.filter(l => l.pipeline_status === 'vendida').length;
      return { k, meta: sourceMeta(k), total: arr.length, won,
        conv: arr.length ? Math.round(won / arr.length * 100) : 0 };
    }).sort((a, b) => b.conv - a.conv || b.total - a.total);
    if (!rows.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">Sem dados de origem ainda.</div></div>';
      return;
    }
    const maxConv = Math.max(1, ...rows.map(r => r.conv));
    el.innerHTML = rows.map((r, i) => `
      <div class="srcperf-row${i === 0 && r.won > 0 ? ' srcperf-best' : ''}">
        <span class="srcperf-ic">${r.meta.icon}</span>
        <span class="srcperf-name">${escapeHtml(r.meta.label)}${i === 0 && r.won > 0 ? ' <b>★ melhor</b>' : ''}</span>
        <span class="srcperf-bar"><span style="width:${r.conv / maxConv * 100}%"></span></span>
        <span class="srcperf-val">${r.conv}%<i>${r.won}/${r.total}</i></span>
      </div>`).join('');
  }

  function renderLeaderboard() {
    const el = $('leaderboard');
    if (!el) return;

    // Stats por vendedor — inclui todos que atuam como vendedor (is_seller),
    // mesmo sem nenhuma venda; ordena pelo desempenho.
    const scoped = dashLeads();
    const stats = state.profiles
      .filter(p => p.is_seller !== false)
      .map(p => {
        const leads = scoped.filter(l => l.assigned_to === p.id);
        const won = leads.filter(l => l.pipeline_status === 'vendida');
        const vendas = won.length;
        const total = leads.length;
        const conv = total > 0 ? Math.round((vendas / total) * 100) : 0;
        const receita = won.reduce((s, l) => s + (Number(l.valor) || 0), 0);
        return { profile: p, total, vendas, conv, receita,
          score: vendas * 10 + total + conv * 0.1 + receita / 1000 };
      })
      .sort((a, b) => b.score - a.score);

    if (stats.length === 0) {
      el.innerHTML = `<div class="empty-state" style="padding:24px 0">
        <div class="empty-state-text">Nenhum vendedor no ranking. Marque "atuo como vendedor" no perfil.</div>
      </div>`;
      return;
    }

    el.innerHTML = stats.map((s, i) => {
      const p = s.profile;
      const av = profileAvatar(p);
      const hasMedal = s.vendas > 0 && i < 3;
      const medal = hasMedal ? ['gold', 'silver', 'bronze'][i] : '';
      const isTop = i === 0 && s.vendas > 0;
      const rankIcon = hasMedal ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`;
      return `
        <div class="leader-row ${medal}${isTop ? ' leader-top' : ''}">
          <span class="leader-rank">${rankIcon}</span>
          <div class="leader-avatar">
            <img src="${av}" alt="" onerror="this.parentElement.textContent='${initials(profileName(p))}'">
          </div>
          <div class="leader-info">
            <div class="leader-name">${escapeHtml(profileName(p))}</div>
            <div class="leader-sub">${p.role === 'admin' ? 'Admin' : 'Vendedor'}${isTop ? ' · 🔥 Top vendedor' : ''}</div>
          </div>
          <div class="leader-stats">
            <div class="leader-stat">
              <div class="leader-stat-num">${s.total}</div>
              <div class="leader-stat-label">Leads</div>
            </div>
            <div class="leader-stat">
              <div class="leader-stat-num" style="color:var(--success)">${s.vendas}</div>
              <div class="leader-stat-label">Vendas</div>
            </div>
            <div class="leader-stat">
              <div class="leader-stat-num" style="color:var(--accent)">${s.conv}%</div>
              <div class="leader-stat-label">Conversão</div>
            </div>
            <div class="leader-stat">
              <div class="leader-stat-num" style="color:#C2410C">${brlShort(s.receita)}</div>
              <div class="leader-stat-label">Receita</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Etapa de "perda" (não conta como avanço no funil)
  function isLossStage(s) {
    return /perd|no.?show|lost/i.test((s.id || '') + ' ' + (s.label || ''));
  }
  // Funil visual REAL — formato de funil que estreita conforme a conversão cai.
  // Cada etapa mostra: quantidade, % do topo, taxa de avanço, taxa de perda.
  function renderFunnel() {
    const f = $('funnel');
    if (!f) return;
    const leads = dashLeads();
    const fstages = state.pipeline.filter(s => !isLossStage(s));
    const orderOf = id => {
      const s = state.pipeline.find(x => x.id === id);
      return s ? s.order : -1;
    };
    const isFunnelId = id => fstages.some(s => s.id === id);
    // Contagem cumulativa: leads cujo estágio atual está nesta etapa ou além
    const reached = fstages.map(st => leads.filter(l =>
      isFunnelId(l.pipeline_status) && orderOf(l.pipeline_status) >= st.order).length);
    const top = Math.max(1, reached[0] || 0);
    const lost = leads.filter(l =>
      state.pipeline.some(s => s.id === l.pipeline_status && isLossStage(s))).length;
    const endConv = Math.round((reached[reached.length - 1] || 0) / top * 100);

    if (!fstages.length) { f.innerHTML = ''; return; }

    const rows = fstages.map((st, i) => {
      const count = reached[i];
      const pctTop = Math.round(count / top * 100);
      const next = reached[i + 1];
      const advance = (i < fstages.length - 1 && count > 0) ? Math.round(next / count * 100) : null;
      const loss = advance != null ? 100 - advance : null;
      // Largura em formato de funil: cada etapa estreita progressivamente
      const width = fstages.length > 1
        ? Math.round(100 - (i / (fstages.length - 1)) * 58)
        : 100;
      return `
        <div class="vfunnel-step">
          <div class="vfunnel-shapecol">
            <div class="vfunnel-shape" style="width:${width}%;--c:${st.color}">
              <span class="vfunnel-count">${count}</span>
              <span class="vfunnel-stname">${escapeHtml(st.label)}</span>
            </div>
            ${advance != null ? `<div class="vfunnel-drop">
              <span class="vfunnel-drop-adv"><svg viewBox="0 0 24 24"><use href="#i-arrow-down"/></svg> ${advance}% avançaram</span>
              ${loss > 0 ? `<span class="vfunnel-drop-loss">${loss}% pararam aqui</span>` : ''}
            </div>` : ''}
          </div>
          <div class="vfunnel-info">
            <div class="vfunnel-kpi"><b>${pctTop}%</b><span>do topo</span></div>
            <div class="vfunnel-kpi"><b>${advance != null ? advance + '%' : '—'}</b><span>taxa de avanço</span></div>
            <div class="vfunnel-kpi vfunnel-kpi-loss"><b>${loss != null ? loss + '%' : '—'}</b><span>taxa de perda</span></div>
            <div class="vfunnel-kpi"><b>${count}</b><span>acumulado</span></div>
          </div>
        </div>`;
    }).join('');

    f.innerHTML = `<div class="vfunnel">${rows}</div>
      <div class="vfunnel-foot">
        <span class="vfunnel-foot-leak"><svg viewBox="0 0 24 24"><use href="#i-flame"/></svg> ${lost} ${lost === 1 ? 'lead perdido' : 'leads perdidos'} (no-show / perdidas)</span>
        <span class="vfunnel-foot-conv">Conversão geral topo → fim: <b>${endConv}%</b></span>
      </div>`;
  }

  function renderTimelineChart() {
    const ctx = $('chart-timeline').getContext('2d');
    if (state.charts.timeline) state.charts.timeline.destroy();

    // Agrupa leads por dia (últimos 30 dias)
    const days = 30;
    const tlLeads = dashLeads();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const labels = [], data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const count = tlLeads.filter(l => {
        const t = new Date(l.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      }).length;
      labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }));
      data.push(count);
    }

    state.charts.timeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Leads',
          data,
          fill: true,
          backgroundColor: 'rgba(15, 118, 110, 0.08)',
          borderColor: '#0F766E',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: '#0F766E',
          tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: '#9CA3AF', font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: '#E8E6E1' }, ticks: { stepSize: 1, color: '#9CA3AF', font: { size: 10 } } }
        }
      }
    });
  }

  function renderRevenueChart() {
    const ctx = $('chart-revenue').getContext('2d');
    if (state.charts.revenue) state.charts.revenue.destroy();

    const buckets = [
      'Até R$ 5 mil/mês',
      'R$ 5 a R$ 15 mil/mês',
      'R$ 15 a R$ 30 mil/mês',
      'R$ 30 a R$ 50 mil/mês',
      'Acima de R$ 50 mil/mês'
    ];
    const rcLeads = dashLeads();
    const data = buckets.map(b => rcLeads.filter(l => l.faturamento === b).length);

    state.charts.revenue = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: buckets.map(b => b.replace('R$ ', '').replace(' mil/mês', 'k').replace('Até ', '<')),
        datasets: [{
          data,
          backgroundColor: '#0F766E',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 60
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6B6B68', font: { size: 11 } } },
          y: { beginAtZero: true, grid: { color: '#E8E6E1' }, ticks: { stepSize: 1, color: '#9CA3AF', font: { size: 10 } } }
        }
      }
    });
  }

  // ─── TRACKING (Traqueamento por fonte) ───
  function renderTracking() {
    const container = $('tracking-cards');
    if (!container) return;

    // Agrupa leads por source_type
    const groups = {};
    state.filtered.forEach(l => {
      const k = l.source_type || 'outro';
      if (!groups[k]) groups[k] = [];
      groups[k].push(l);
    });

    // Ordem desejada das fontes
    const order = ['trafego_pago', 'stories', 'bio_link', 'direct', 'instagram_organico', 'facebook_organico', 'direto', 'outro'];
    const sortedKeys = order.filter(k => groups[k] && groups[k].length > 0);

    if (sortedKeys.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Nenhum lead com fonte registrada ainda</div>
          <div class="empty-state-text">Adicione UTMs nas URLs do quiz que você compartilha pra ver os dados aqui.</div>
        </div>`;
      return;
    }

    const html = sortedKeys.map(key => {
      const meta = sourceMeta(key);
      const leads = groups[key];
      const total = leads.length;

      // Conta por status do pipeline (procura ids padrão; se forem renomeados, busca por label aproximado)
      const countByStatus = (statusKeyword) => {
        const stage = state.pipeline.find(s =>
          s.id === statusKeyword ||
          s.label.toLowerCase().includes(statusKeyword.replace('_', ' '))
        );
        return stage ? leads.filter(l => l.pipeline_status === stage.id).length : 0;
      };

      const counts = {
        leads:    total,
        agendou:  countByStatus('agendou'),
        realizou: countByStatus('call_realizada'),
        comprou:  countByStatus('vendida'),
        noshow:   countByStatus('no_show'),
        perdeu:   countByStatus('perdida')
      };

      const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

      const row = (ic, lb, val, p) => `
        <div class="source-row">
          <span class="sr-ic">${ic}</span>
          <span class="sr-lb">${lb}</span>
          <span class="sr-bar"><span style="width:${p}%"></span></span>
          <span class="sr-val">${val}<i>${p}%</i></span>
        </div>`;
      return `
        <div class="source-card" data-source="${key}" style="--src-bg:${meta.bg}">
          <div class="source-card-icon">${meta.icon}</div>
          <div class="source-card-head">
            <div class="source-card-name">${escapeHtml(meta.label)}</div>
            <div class="source-card-sub">${total} ${total === 1 ? 'lead' : 'leads'} · clique para ver</div>
          </div>
          <div class="source-rows">
            ${row('👀', 'Vieram', counts.leads, 100)}
            ${row('📅', 'Agendaram', counts.agendou, pct(counts.agendou))}
            ${row('✅', 'Realizaram', counts.realizou, pct(counts.realizou))}
            ${row('💰', 'Compraram', counts.comprou, pct(counts.comprou))}
            ${row('🚫', 'No show', counts.noshow, pct(counts.noshow))}
            ${row('⚠️', 'Perderam', counts.perdeu, pct(counts.perdeu))}
          </div>
        </div>
      `;
    }).join('');
    container.innerHTML = html;

    // Wire clicks pra abrir modal de detalhes
    container.querySelectorAll('.source-card').forEach(card => {
      card.addEventListener('click', () => {
        openSourceModal(card.dataset.source);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL: Detalhes de uma fonte (lista de leads + criativos)
  // ═══════════════════════════════════════════════════════════════════
  let sourceModalState = { key: null, tab: 'leads' };

  function openSourceModal(sourceKey) {
    const meta = sourceMeta(sourceKey);
    const leads = state.leads.filter(l => (l.source_type || 'outro') === sourceKey);

    sourceModalState = { key: sourceKey, tab: 'leads' };

    $('source-modal-icon').textContent = meta.icon;
    $('source-modal-icon').style.background = meta.bg;
    $('source-modal-name').textContent = meta.label;
    $('source-modal-sub').textContent = `${leads.length} ${leads.length === 1 ? 'lead chegou' : 'leads chegaram'} por este canal`;
    $('source-modal-total').textContent = leads.length;

    // Mostra/esconde tabs específicas de tráfego pago
    $$('#source-modal-tabs .source-tab').forEach(t => {
      const only = t.dataset.only;
      if (only) t.style.display = (sourceKey === only) ? '' : 'none';
      t.classList.toggle('active', t.dataset.tab === 'leads');
    });

    renderSourceModalContent(leads);
    $('source-modal-backdrop').classList.add('show');
  }

  function renderSourceModalContent(leads) {
    const content = $('source-modal-content');
    const tab = sourceModalState.tab;

    if (tab === 'leads') {
      if (leads.length === 0) {
        content.innerHTML = '<div class="empty-state"><div class="empty-state-text">Nenhum lead deste canal ainda.</div></div>';
        return;
      }
      content.innerHTML = `<div class="mini-lead-list">${leads.map(l => miniLeadRow(l)).join('')}</div>`;
      content.querySelectorAll('.mini-lead-row').forEach(r => {
        r.addEventListener('click', () => {
          $('source-modal-backdrop').classList.remove('show');
          openLeadModal(r.dataset.leadId);
        });
      });
    } else if (tab === 'campaigns') {
      content.innerHTML = renderSourceBreakdown(leads, 'source_campaign', 'Campanha');
    } else if (tab === 'creatives') {
      content.innerHTML = renderSourceBreakdown(leads, 'source_creative', 'Criativo');
    }
  }

  function miniLeadRow(l) {
    const stage = findStage(l.pipeline_status);
    const av = avatarUrl(l.instagram, l.nome);
    return `
      <div class="mini-lead-row" data-lead-id="${l.id}">
        <div class="mini-lead-avatar"><img src="${av}" alt="" onerror="${avatarFallback(l.nome)}"></div>
        <div class="mini-lead-info">
          <div class="mini-lead-name">${escapeHtml(l.nome)} ${scoreBadge(l)}</div>
          <div class="mini-lead-meta">${escapeHtml(l.instagram || '')} · ${escapeHtml(l.faturamento || '—')}${l.source_campaign ? ' · ' + escapeHtml(l.source_campaign) : ''}</div>
        </div>
        <span class="mini-lead-status" style="background:${stage.color}33;color:#1A1A18">${escapeHtml(stage.label)}</span>
        <span class="mini-lead-time">${relativeTime(l.created_at)}</span>
      </div>
    `;
  }

  function renderSourceBreakdown(leads, field, label) {
    const groups = {};
    leads.forEach(l => {
      const k = l[field] || 'sem ' + label.toLowerCase();
      if (!groups[k]) groups[k] = [];
      groups[k].push(l);
    });
    const rows = Object.entries(groups).map(([k, arr]) => {
      const total = arr.length;
      const agendou  = arr.filter(l => l.pipeline_status === 'agendou').length;
      const realizou = arr.filter(l => l.pipeline_status === 'call_realizada').length;
      const vendida  = arr.filter(l => l.pipeline_status === 'vendida').length;
      const conv = total > 0 ? Math.round((vendida / total) * 100) : 0;
      return { k, total, agendou, realizou, vendida, conv };
    }).sort((a, b) => b.total - a.total);

    if (rows.length === 0) {
      return '<div class="empty-state"><div class="empty-state-text">Sem dados de ' + label.toLowerCase() + ' neste canal.</div></div>';
    }

    return `
      <table class="creative-table">
        <thead>
          <tr>
            <th>${escapeHtml(label)}</th>
            <th class="num" style="text-align:right">Leads</th>
            <th class="num" style="text-align:right">Agendou</th>
            <th class="num" style="text-align:right">Realizou</th>
            <th class="num" style="text-align:right">Vendeu</th>
            <th class="num" style="text-align:right">Conv.</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.k)}</td>
              <td class="num">${r.total}</td>
              <td class="num">${r.agendou}</td>
              <td class="num">${r.realizou}</td>
              <td class="num" style="color:var(--success)">${r.vendida}</td>
              <td class="num" style="color:var(--accent)">${r.conv}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ─── SETTINGS ───
  // ═══════════════════════════════════════════════════════════════════
  // TAREFAS
  // ═══════════════════════════════════════════════════════════════════
  async function loadTasks() {
    const { data, error } = await supabase
      .from('tasks').select('*').eq('project_id', state.projectId)
      .order('created_at', { ascending: false });
    if (error) { console.warn('Tasks falhou', error); state.tasks = []; return; }
    state.tasks = data || [];
  }

  // Data local no formato YYYY-MM-DD (igual ao tipo `date` do Postgres)
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function startOfTodayMs() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function startOfWeekMs() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const offset = (d.getDay() + 6) % 7; // segunda = início da semana
    d.setDate(d.getDate() - offset);
    return d.getTime();
  }
  function startOfMonthMs() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  function formatTaskDate(iso) {
    if (!iso) return '';
    const today = todayISO();
    if (iso === today) return 'Hoje';
    const d = new Date(iso + 'T00:00:00');
    const diff = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
    if (diff === 1) return 'Amanhã';
    if (diff === -1) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  function renderTaskDashboard() {
    const today = todayISO();
    const sod = startOfTodayMs(), sow = startOfWeekMs(), som = startOfMonthMs();
    let dueToday = 0, doneDay = 0, doneWeek = 0, doneMonth = 0;
    state.tasks.forEach(t => {
      if (!t.done && t.due_date === today) dueToday++;
      if (t.done && t.completed_at) {
        const c = new Date(t.completed_at).getTime();
        if (c >= sod) doneDay++;
        if (c >= sow) doneWeek++;
        if (c >= som) doneMonth++;
      }
    });
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('ts-due-today', dueToday);
    set('ts-done-day', doneDay);
    set('ts-done-week', doneWeek);
    set('ts-done-month', doneMonth);
    // Badge no menu lateral = tarefas que vencem hoje
    const badge = $('nav-badge-tasks');
    if (badge) {
      if (dueToday > 0) { badge.textContent = dueToday; badge.style.display = ''; }
      else badge.style.display = 'none';
    }
    const tt = $('topbar-tasks-count');
    if (tt) tt.textContent = dueToday;
  }

  function taskRowHTML(t) {
    const today = todayISO();
    const overdue = !t.done && t.due_date && t.due_date < today;
    const dueToday = !t.done && t.due_date === today;
    let dueLabel = formatTaskDate(t.due_date);
    if (dueLabel && t.due_time) dueLabel += ' ' + String(t.due_time).slice(0, 5);
    // Responsável: mostra o chip para o admin (que vê tarefas de todos)
    const resp = isAdmin() ? profileById(t.vendedor_id) : null;
    const respChip = resp
      ? `<span class="task-resp" title="Responsável: ${escapeHtml(profileName(resp))}">
           <img src="${profileAvatar(resp)}" alt="">
           ${escapeHtml(profileName(resp))}</span>`
      : '';
    const lead = t.lead_id ? state.leads.find(l => l.id === t.lead_id) : null;
    const leadChip = lead
      ? `<span class="task-lead-chip" data-task-lead="${lead.id}" title="Abrir lead ${escapeHtml(lead.nome || '')}">👤 ${escapeHtml(firstName(lead.nome) || 'Lead')}</span>`
      : '';
    const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
    const subDone = subs.filter(s => s.done).length;
    const hasSubs = subs.length > 0;
    const expanded = !!(state.expandedTasks && state.expandedTasks[t.id]);
    const subProg = hasSubs
      ? `<div class="task-sub-prog">
           <span class="task-sub-bar"><span style="width:${Math.round(subDone / subs.length * 100)}%"></span></span>
         </div>`
      : '';
    const subToggle = hasSubs
      ? `<button class="task-sub-toggle ${expanded ? 'open' : ''}" data-task-subs="${t.id}"
                 title="${expanded ? 'Ocultar subtarefas' : 'Mostrar subtarefas'}">
           <span>${subDone}/${subs.length}</span>
           <svg viewBox="0 0 24 24"><use href="#i-arrow-down"/></svg>
         </button>`
      : '';
    const subsPanel = hasSubs
      ? `<div class="task-subs ${expanded ? 'open' : ''}">
          ${subs.map((s, i) => {
            const sp = s.assignee ? profileById(s.assignee) : null;
            const sOverdue = !s.done && s.due && s.due < today;
            return `<div class="task-sub-item ${s.done ? 'done' : ''}">
              <button class="subtask-check ${s.done ? 'checked' : ''}" data-subtask-toggle="${t.id}:${i}" title="${s.done ? 'Reabrir' : 'Concluir'}">
                <svg><use href="#i-check"/></svg>
              </button>
              <span class="task-sub-name">${escapeHtml(s.title)}</span>
              ${sp ? `<span class="task-sub-meta">👤 ${escapeHtml(firstName(sp.nome) || profileName(sp))}</span>` : ''}
              ${s.due ? `<span class="task-sub-meta ${sOverdue ? 'overdue' : ''}">📅 ${formatTaskDate(s.due)}</span>` : ''}
            </div>`;
          }).join('')}
         </div>`
      : '';
    return `
      <div class="task-item">
        <div class="task-row ${t.done ? 'done' : ''}" data-task-id="${t.id}">
          <button class="task-check ${t.done ? 'checked' : ''}" data-task-toggle="${t.id}"
                  title="${t.done ? 'Reabrir tarefa' : 'Concluir tarefa'}">
            <svg><use href="#i-check"/></svg>
          </button>
          <div class="task-row-main" data-task-open="${t.id}">
            <div class="task-row-title">
              ${t.priority === 'alta' ? '<span class="task-prio-dot" title="Prioridade alta"></span>' : ''}
              ${escapeHtml(t.title)}
            </div>
            ${t.description ? `<div class="task-row-desc">${escapeHtml(t.description)}</div>` : ''}
            ${subProg}
          </div>
          ${subToggle}
          ${leadChip}
          ${respChip}
          ${dueLabel ? `<span class="task-due ${overdue ? 'overdue' : ''} ${dueToday ? 'today' : ''}">
            <svg><use href="#i-calendar"/></svg>${dueLabel}</span>` : ''}
          <button class="task-row-del" data-task-del="${t.id}" title="Excluir tarefa">
            <svg><use href="#i-trash"/></svg>
          </button>
        </div>
        ${subsPanel}
      </div>`;
  }

  async function toggleSubtaskDone(taskId, idx) {
    const t = state.tasks.find(x => x.id === taskId);
    if (!t || !Array.isArray(t.subtasks) || !t.subtasks[idx]) return;
    t.subtasks[idx].done = !t.subtasks[idx].done;
    renderTasks();
    const { error } = await supabase.from('tasks')
      .update({ subtasks: t.subtasks }).eq('id', taskId);
    if (error) {
      t.subtasks[idx].done = !t.subtasks[idx].done;
      renderTasks();
      toast('Erro: ' + error.message, 'error');
    }
  }

  // ─── Editor de subtarefas ───
  function subGenId() { return 's' + Math.random().toString(36).slice(2, 8); }
  function renderSubtaskEditor() {
    const el = $('subtask-list');
    if (!el) return;
    if (!state.editingSubtasks.length) {
      el.innerHTML = '<div class="subtask-empty">Nenhuma subtarefa — quebre a tarefa em passos menores.</div>';
      return;
    }
    el.innerHTML = state.editingSubtasks.map(s => `
      <div class="subtask-row" data-sub-id="${s.id}">
        <button type="button" class="subtask-check ${s.done ? 'checked' : ''}" data-sub-toggle="${s.id}">
          <svg><use href="#i-check"/></svg>
        </button>
        <input type="text" class="input-text subtask-title" data-sub-title="${s.id}" value="${escapeHtml(s.title || '')}" placeholder="O que precisa ser feito">
        <select class="input-text subtask-assignee" data-sub-assignee="${s.id}">
          <option value="">Responsável</option>
          ${state.profiles.map(p => `<option value="${p.id}" ${p.id === s.assignee ? 'selected' : ''}>${escapeHtml(firstName(p.nome) || profileName(p))}</option>`).join('')}
        </select>
        <input type="date" class="input-text subtask-due" data-sub-due="${s.id}" value="${s.due || ''}">
        <button type="button" class="subtask-del" data-sub-del="${s.id}" title="Remover">✕</button>
      </div>`).join('');
  }
  // Lê os campos do editor de volta para o state
  function syncSubtaskEditor() {
    $$('#subtask-list .subtask-row').forEach(row => {
      const s = state.editingSubtasks.find(x => x.id === row.dataset.subId);
      if (!s) return;
      const ti = row.querySelector('[data-sub-title]'); if (ti) s.title = ti.value;
      const as = row.querySelector('[data-sub-assignee]'); if (as) s.assignee = as.value || null;
      const du = row.querySelector('[data-sub-due]'); if (du) s.due = du.value || null;
    });
  }

  function renderTasks() {
    renderTaskDashboard();
    const list = $('tasks-list');
    if (!list) return;
    const filter = state.taskFilter;
    let tasks = state.tasks.slice();
    if (filter === 'pending') tasks = tasks.filter(t => !t.done);
    else if (filter === 'done') tasks = tasks.filter(t => t.done);

    tasks.sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (!a.done) {
        const ad = a.due_date || '9999-99-99', bd = b.due_date || '9999-99-99';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return new Date(b.created_at) - new Date(a.created_at);
      }
      return new Date(b.completed_at || 0) - new Date(a.completed_at || 0);
    });

    if (!tasks.length) {
      const msg = filter === 'done' ? 'Nenhuma tarefa concluída ainda.'
        : filter === 'pending' ? 'Nenhuma tarefa pendente. Tudo em dia! 🎉'
        : 'Nenhuma tarefa cadastrada.';
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">${msg}</div></div>`;
      return;
    }
    list.innerHTML = tasks.map(taskRowHTML).join('');
  }

  function openTaskModal(id, presetTitle) {
    const t = id ? state.tasks.find(x => x.id === id) : null;
    state.editingTask = t || null;
    $('task-modal-title').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('task-title').value = t ? (t.title || '') : (presetTitle || '');
    $('task-due').value = t ? (t.due_date || '') : '';
    $('task-time').value = t && t.due_time ? String(t.due_time).slice(0, 5) : '';
    $('task-priority').value = t ? (t.priority || 'normal') : 'normal';
    $('task-description').value = t ? (t.description || '') : '';
    $('task-done').checked = t ? !!t.done : false;
    // Responsável — admin escolhe qualquer vendedor; vendedor fica travado em si
    const adminUser = isAdmin();
    const sel = $('task-assignee');
    sel.innerHTML = state.profiles.map(p =>
      `<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
    sel.value = t ? t.vendedor_id : state.user.id;
    sel.disabled = !adminUser;
    // Lead vinculado
    const leadSel = $('task-lead');
    leadSel.innerHTML = '<option value="">— Nenhum —</option>' +
      state.leads.map(l => `<option value="${l.id}">${escapeHtml(l.nome || 'Lead')}</option>`).join('');
    leadSel.value = t ? (t.lead_id || '') : '';
    // Subtarefas
    state.editingSubtasks = (t && Array.isArray(t.subtasks) ? t.subtasks : []).map(s => ({
      id: s.id || subGenId(), title: s.title || '', done: !!s.done,
      assignee: s.assignee || null, due: s.due || null
    }));
    renderSubtaskEditor();
    $('task-delete').style.display = t ? '' : 'none';
    $('task-modal-backdrop').classList.add('show');
    setTimeout(() => $('task-title').focus(), 60);
  }

  async function saveTask() {
    const title = $('task-title').value.trim();
    if (!title) { toast('Dê um título à tarefa', 'error'); return; }
    const done = $('task-done').checked;
    const editing = state.editingTask;
    syncSubtaskEditor();
    const patch = {
      title,
      due_date: $('task-due').value || null,
      due_time: $('task-time').value || null,
      priority: $('task-priority').value || 'normal',
      description: $('task-description').value.trim() || null,
      done,
      completed_at: done
        ? ((editing && editing.done && editing.completed_at) ? editing.completed_at : new Date().toISOString())
        : null,
      vendedor_id: $('task-assignee').value || state.user.id,
      lead_id: $('task-lead').value || null,
      subtasks: state.editingSubtasks.filter(s => (s.title || '').trim()),
      project_id: state.projectId
    };
    const btn = $('task-save');
    btn.disabled = true;
    let error;
    if (editing) {
      ({ error } = await supabase.from('tasks').update(patch).eq('id', editing.id));
    } else {
      ({ error } = await supabase.from('tasks').insert(patch));
    }
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadTasks();
    renderTasks();
    closeAllModals();
    toast(editing ? 'Tarefa atualizada' : 'Tarefa criada', 'success');
  }

  async function toggleTaskDone(id) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    const done = !t.done;
    const prev = { done: t.done, completed_at: t.completed_at };
    t.done = done;
    t.completed_at = done ? new Date().toISOString() : null;
    renderTasks();
    const { error } = await supabase.from('tasks')
      .update({ done: t.done, completed_at: t.completed_at }).eq('id', id);
    if (error) {
      Object.assign(t, prev);
      renderTasks();
      toast('Erro: ' + error.message, 'error');
    }
  }

  async function deleteTask(id) {
    if (!confirm('Excluir esta tarefa permanentemente?')) return;
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.tasks = state.tasks.filter(t => t.id !== id);
    closeAllModals();
    renderTasks();
    toast('Tarefa excluída', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // AGENDA
  // ═══════════════════════════════════════════════════════════════════
  const AG_MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const AG_WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function hm(iso) { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

  async function loadAppointments() {
    const { data, error } = await supabase
      .from('appointments').select('*').eq('project_id', state.projectId)
      .order('starts_at', { ascending: true });
    if (error) { console.warn('Appointments falhou', error); state.appointments = []; return; }
    state.appointments = data || [];
  }

  function ensureAgendaState() {
    if (!state.agendaMonth) {
      const t = new Date();
      state.agendaMonth = new Date(t.getFullYear(), t.getMonth(), 1);
    }
    if (!state.agendaSelectedDay) state.agendaSelectedDay = ymd(new Date());
  }

  // ─── Integração Google (via Edge Function) ───
  async function callGoogleFn(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/google-calendar', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': CONFIG.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return res.json();
  }

  async function refreshGoogleStatus() {
    try {
      const r = await callGoogleFn({ action: 'status' });
      state.googleStatus = { connected: !!r.connected, email: r.email || null };
    } catch (_) {
      state.googleStatus = { connected: false, email: null };
    }
    renderGoogleConn();
  }

  // Render do bloco de conexão Google em Configurações → Google
  function renderGoogleConn() {
    const el = $('google-conn');
    if (!el) return;
    const gs = state.googleStatus;
    if (gs.connected) {
      el.innerHTML = `<div class="google-conn-status connected">
          <span class="agenda-gdot"></span> Conta conectada: <strong>${escapeHtml(gs.email || '')}</strong>
        </div>
        <button class="modal-btn" id="btn-google-disconnect">Desconectar conta</button>`;
    } else {
      el.innerHTML = `<div class="google-conn-status">Nenhuma conta Google conectada.</div>
        <button class="btn-primary" id="btn-google-connect">
          <svg><use href="#i-calendar"/></svg> Conectar conta Google</button>`;
    }
    const c = $('btn-google-connect'); if (c) c.onclick = connectGoogle;
    const d = $('btn-google-disconnect'); if (d) d.onclick = disconnectGoogle;
  }

  async function connectGoogle() {
    const stateTok = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem('g_oauth_state', stateTok);
    try {
      const r = await callGoogleFn({ action: 'oauth-url', redirect_uri: location.origin, state: stateTok });
      if (r.url) window.location.href = r.url;
      else toast(r.error || 'Erro ao iniciar conexão Google', 'error');
    } catch (e) {
      toast('Erro ao conectar: ' + e.message, 'error');
    }
  }

  async function disconnectGoogle() {
    if (!confirm('Desconectar a conta Google? A Agenda continua funcionando, sem sincronizar.')) return;
    await callGoogleFn({ action: 'disconnect' });
    await refreshGoogleStatus();
    toast('Conta Google desconectada', 'success');
  }

  // Trata o retorno do OAuth (?code=... na URL após o consentimento Google)
  async function handleGoogleOAuthReturn() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return;
    const returnedState = params.get('state');
    const saved = sessionStorage.getItem('g_oauth_state');
    history.replaceState({}, document.title, location.pathname);  // limpa a URL
    if (!saved || saved !== returnedState) {
      toast('Falha de verificação na conexão Google. Tente de novo.', 'error');
      return;
    }
    sessionStorage.removeItem('g_oauth_state');
    try {
      const r = await callGoogleFn({ action: 'oauth-callback', code, redirect_uri: location.origin });
      if (r.ok) {
        toast('Conta Google conectada: ' + (r.email || ''), 'success');
        await refreshGoogleStatus();
      } else {
        toast(r.error || 'Falha ao conectar Google', 'error');
      }
    } catch (e) {
      toast('Erro ao conectar Google: ' + e.message, 'error');
    }
  }

  // Sincroniza um compromisso com o Google Calendar (best-effort)
  async function syncAppointmentToGoogle(op, appt) {
    if (!state.googleStatus.connected && op !== 'delete') return;
    try {
      const r = await callGoogleFn({ action: 'sync-event', op, appointment: appt });
      if (r && r.google_event_id && r.google_event_id !== appt.google_event_id) {
        await supabase.from('appointments')
          .update({ google_event_id: r.google_event_id }).eq('id', appt.id);
        const local = state.appointments.find(a => a.id === appt.id);
        if (local) local.google_event_id = r.google_event_id;
      }
    } catch (e) {
      console.warn('Sync Google falhou:', e);
    }
  }

  // Move o lead para a etapa "reunião agendada" do pipeline
  function moveLeadToScheduled(leadId) {
    const stage = state.pipeline.find(s => s.id === 'agendou')
      || state.pipeline.find(s => /agend|reuni/i.test(s.label || ''));
    if (!stage) return;
    const lead = state.leads.find(l => l.id === leadId);
    if (!lead || lead.pipeline_status === stage.id) return;
    updateLead(leadId, { pipeline_status: stage.id });
    toast(`Lead movido para "${stage.label}"`, 'success');
  }

  // ─── Render ───
  // Os 7 dias (domingo→sábado) da semana que contém a data iso
  function weekDays(iso) {
    const d = new Date(iso + 'T00:00:00');
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start); x.setDate(start.getDate() + i); return x;
    });
  }

  // Avança/recua a agenda conforme a visão atual (mês/semana/dia)
  function agendaShift(dir) {
    if (state.agendaView === 'month') {
      const m = state.agendaMonth;
      state.agendaMonth = new Date(m.getFullYear(), m.getMonth() + dir, 1);
    } else {
      const step = state.agendaView === 'week' ? 7 : 1;
      const d = new Date(state.agendaSelectedDay + 'T00:00:00');
      d.setDate(d.getDate() + dir * step);
      state.agendaSelectedDay = ymd(d);
      state.agendaMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    renderAgenda();
  }

  function renderAgenda() {
    ensureAgendaState();
    const wrap = document.querySelector('.agenda');
    if (wrap) wrap.setAttribute('data-aview', state.agendaView);
    $$('#agenda-views .agenda-view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.aview === state.agendaView));
    renderAgendaGStatus();
    renderAgendaHeader();
    renderAgendaGrid();
    renderAgendaDay();
  }

  function renderAgendaGStatus() {
    const el = $('agenda-gstatus');
    if (!el) return;
    const gs = state.googleStatus || {};
    if (gs.connected) {
      el.className = 'agenda-gstatus connected';
      el.innerHTML = `<span class="agenda-gdot"></span> Google Calendar conectado`;
      el.title = 'Sincronizando com ' + (gs.email || 'sua conta Google');
    } else {
      el.className = 'agenda-gstatus';
      el.innerHTML = `<span class="agenda-gdot"></span> Google Calendar não conectado`;
      el.title = 'Conecte sua conta em Configurações → Google / Agenda';
    }
  }

  // Importa eventos do Google Calendar para a Agenda (sincronização bidirecional)
  async function importGoogleEvents() {
    if (!state.googleStatus.connected) {
      toast('Conecte uma conta Google em Configurações → Google / Agenda', 'error');
      switchView('settings');
      showSettingsSection('google');
      return;
    }
    const btn = $('btn-agenda-sync');
    if (btn) { btn.disabled = true; }
    try {
      const r = await callGoogleFn({ action: 'import-events' });
      if (r.error) { toast('Erro ao sincronizar: ' + r.error, 'error'); return; }
      const events = r.events || [];
      const known = new Set(state.appointments.map(a => a.google_event_id).filter(Boolean));
      const novos = events.filter(e => e.google_event_id && !known.has(e.google_event_id));
      if (!novos.length) { toast('Agenda já está sincronizada — nada novo no Google', 'success'); return; }
      const rows = novos.map(e => ({
        vendedor_id: state.user.id, project_id: state.projectId,
        title: e.title, starts_at: e.starts_at, ends_at: e.ends_at,
        location: e.location, notes: e.notes, google_event_id: e.google_event_id
      }));
      const { error } = await supabase.from('appointments').insert(rows);
      if (error) { toast('Erro ao importar: ' + error.message, 'error'); return; }
      await loadAppointments();
      renderAgenda();
      toast(`${novos.length} evento(s) importado(s) do Google Calendar`, 'success');
    } catch (e) {
      toast('Erro ao sincronizar: ' + e.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderAgendaHeader() {
    ensureAgendaState();
    const label = $('agenda-month-label');
    if (!label) return;
    if (state.agendaView === 'day') {
      const d = new Date(state.agendaSelectedDay + 'T00:00:00');
      label.textContent = d.toLocaleDateString('pt-BR',
        { weekday: 'long', day: '2-digit', month: 'long' });
    } else if (state.agendaView === 'week') {
      const days = weekDays(state.agendaSelectedDay);
      const a = days[0], b = days[6];
      label.textContent = `${a.getDate()} ${AG_MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${AG_MONTHS[b.getMonth()].slice(0, 3)}`;
    } else {
      const m = state.agendaMonth;
      label.textContent = AG_MONTHS[m.getMonth()] + ' ' + m.getFullYear();
    }
  }

  function renderAgendaGrid() {
    const grid = $('agenda-grid');
    if (!grid) return;
    if (state.agendaView === 'day') { grid.innerHTML = ''; return; }

    const todayStr = ymd(new Date());
    const byDay = {};
    state.appointments.forEach(a => {
      const k = ymd(new Date(a.starts_at));
      (byDay[k] = byDay[k] || []).push(a);
    });
    const limit = state.agendaView === 'week' ? 10 : 3;

    const cellHTML = (d, dim) => {
      const k = ymd(d);
      const appts = (byDay[k] || []).slice().sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      const chips = appts.slice(0, limit).map(a =>
        `<div class="cal-chip" data-appt="${a.id}"><b>${hm(a.starts_at)}</b> ${escapeHtml(a.title)}</div>`
      ).join('');
      const more = appts.length > limit ? `<div class="cal-more">+${appts.length - limit} mais</div>` : '';
      return `<div class="cal-day${dim ? ' other' : ''}${k === todayStr ? ' today' : ''}${k === state.agendaSelectedDay ? ' selected' : ''}" data-day="${k}">
        <div class="cal-daynum">${d.getDate()}</div>${chips}${more}</div>`;
    };

    let html = AG_WEEKDAYS.map(w => `<div class="cal-wd">${w}</div>`).join('');
    if (state.agendaView === 'week') {
      weekDays(state.agendaSelectedDay).forEach(d => { html += cellHTML(d, false); });
    } else {
      const m = state.agendaMonth;
      const first = new Date(m.getFullYear(), m.getMonth(), 1);
      const gridStart = new Date(first);
      gridStart.setDate(1 - first.getDay());
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        html += cellHTML(d, d.getMonth() !== m.getMonth());
      }
    }
    grid.innerHTML = html;
  }

  function renderAgendaDay() {
    const day = state.agendaSelectedDay;
    const d = new Date(day + 'T00:00:00');
    const label = $('agenda-day-label');
    if (label) {
      label.textContent = d.toLocaleDateString('pt-BR',
        { weekday: 'long', day: '2-digit', month: 'long' });
    }
    const list = $('agenda-day-list');
    if (!list) return;
    const appts = state.appointments
      .filter(a => ymd(new Date(a.starts_at)) === day)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    if (!appts.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">
        Nenhuma reunião neste dia.</div></div>`;
      return;
    }
    list.innerHTML = appts.map(a => {
      const lead = a.lead_id ? state.leads.find(l => l.id === a.lead_id) : null;
      return `<div class="appt-row" data-appt="${a.id}">
        <div class="appt-time"><b>${hm(a.starts_at)}</b><span>${hm(a.ends_at)}</span></div>
        <div class="appt-main">
          <div class="appt-title">${escapeHtml(a.title)}</div>
          ${lead ? `<div class="appt-meta">👤 ${escapeHtml(lead.nome || 'Lead')}</div>` : ''}
          ${a.location ? `<div class="appt-meta">📍 ${escapeHtml(a.location)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ─── CRUD ───
  function openAppointmentModal(id, presetDay) {
    const a = id ? state.appointments.find(x => x.id === id) : null;
    state.editingAppointment = a || null;
    $('appt-modal-title').textContent = a ? 'Editar reunião' : 'Nova reunião';
    $('appt-title').value = a ? a.title : '';
    $('appt-date').value = a ? ymd(new Date(a.starts_at)) : (presetDay || state.agendaSelectedDay || ymd(new Date()));
    $('appt-start').value = a ? hm(a.starts_at) : '09:00';
    $('appt-end').value = a ? hm(a.ends_at) : '10:00';
    $('appt-location').value = a ? (a.location || '') : '';
    $('appt-notes').value = a ? (a.notes || '') : '';

    const sel = $('appt-lead');
    sel.innerHTML = '<option value="">— Nenhum lead —</option>' +
      state.leads.map(l =>
        `<option value="${l.id}">${escapeHtml((l.nome || 'Lead') + (l.telefone ? ' · ' + l.telefone : ''))}</option>`
      ).join('');
    sel.value = a ? (a.lead_id || '') : '';

    $('appt-delete').style.display = a ? '' : 'none';
    $('appt-modal-backdrop').classList.add('show');
    setTimeout(() => $('appt-title').focus(), 60);
  }

  async function saveAppointment() {
    const title = $('appt-title').value.trim();
    const date = $('appt-date').value;
    const start = $('appt-start').value;
    const end = $('appt-end').value;
    if (!title) { toast('Dê um título à reunião', 'error'); return; }
    if (!date || !start || !end) { toast('Preencha data e horários', 'error'); return; }
    const starts_at = new Date(`${date}T${start}`).toISOString();
    const ends_at = new Date(`${date}T${end}`).toISOString();
    if (new Date(ends_at) <= new Date(starts_at)) {
      toast('O horário de fim deve ser depois do início', 'error'); return;
    }
    const leadId = $('appt-lead').value || null;
    const editing = state.editingAppointment;
    const patch = {
      title, starts_at, ends_at, lead_id: leadId,
      location: $('appt-location').value.trim() || null,
      notes: $('appt-notes').value.trim() || null
    };
    const btn = $('appt-save');
    btn.disabled = true;
    let saved, error;
    if (editing) {
      ({ data: saved, error } = await supabase.from('appointments')
        .update(patch).eq('id', editing.id).select().single());
    } else {
      patch.vendedor_id = state.user.id;
      patch.project_id = state.projectId;
      ({ data: saved, error } = await supabase.from('appointments')
        .insert(patch).select().single());
    }
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }

    syncAppointmentToGoogle(editing ? 'update' : 'create', { ...saved });
    if (leadId) moveLeadToScheduled(leadId);

    await loadAppointments();
    state.agendaSelectedDay = ymd(new Date(starts_at));
    renderAgenda();
    closeAllModals();
    toast(editing ? 'Reunião atualizada' : 'Reunião agendada', 'success');
  }

  async function deleteAppointment(id) {
    const a = state.appointments.find(x => x.id === id);
    if (!a) return;
    if (!confirm('Excluir esta reunião permanentemente?')) return;
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    if (a.google_event_id) syncAppointmentToGoogle('delete', { ...a });
    state.appointments = state.appointments.filter(x => x.id !== id);
    closeAllModals();
    renderAgenda();
    toast('Reunião excluída', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // AUTOMAÇÕES
  // ═══════════════════════════════════════════════════════════════════
  async function loadScheduledMessages() {
    const { data, error } = await supabase
      .from('scheduled_messages').select('*').eq('project_id', state.projectId)
      .order('send_at', { ascending: true });
    if (error) { console.warn('Scheduled messages falhou', error); state.scheduledMessages = []; return; }
    state.scheduledMessages = data || [];
  }

  async function loadAutomationSettings() {
    const { data } = await supabase.from('automation_settings').select('*').eq('id', 1).maybeSingle();
    const c = data || {};
    $('rem-1d-enabled').checked = !!c.remind_1d_enabled;
    $('rem-1d-text').value = c.remind_1d_text || '';
    $('rem-1h-enabled').checked = !!c.remind_1h_enabled;
    $('rem-1h-text').value = c.remind_1h_text || '';
  }

  async function saveReminders() {
    const btn = $('btn-save-reminders');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando';
    const patch = {
      remind_1d_enabled: $('rem-1d-enabled').checked,
      remind_1d_text: $('rem-1d-text').value.trim() || null,
      remind_1h_enabled: $('rem-1h-enabled').checked,
      remind_1h_text: $('rem-1h-text').value.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: state.user.id
    };
    const { error } = await supabase.from('automation_settings').update(patch).eq('id', 1);
    btn.disabled = false;
    btn.innerHTML = '<svg><use href="#i-check"/></svg> Salvar';
    if (error) toast('Erro: ' + error.message, 'error');
    else toast('Lembretes salvos', 'success');
  }

  function fmtSchedWhen(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hm(iso);
  }

  function renderSchedMsgList() {
    const list = $('schedmsg-list');
    if (!list) return;
    const msgs = state.scheduledMessages.slice()
      .sort((a, b) => new Date(a.send_at) - new Date(b.send_at));
    if (!msgs.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">
        Nenhuma mensagem agendada.</div></div>`;
      return;
    }
    const stLabel = { pending: 'Pendente', sent: 'Enviada', failed: 'Falhou', canceled: 'Cancelada' };
    list.innerHTML = msgs.map(m => {
      const lead = m.lead_id ? state.leads.find(l => l.id === m.lead_id) : null;
      return `<div class="schedmsg-row">
        <span class="schedmsg-st schedmsg-st-${m.status}">${stLabel[m.status] || m.status}</span>
        <div class="schedmsg-main">
          <div class="schedmsg-lead">${escapeHtml(lead ? (lead.nome || 'Lead') : '(lead removido)')}</div>
          <div class="schedmsg-body">${escapeHtml(m.body || '')}</div>
          ${m.media_url ? `<div class="schedmsg-media">${mediaLabel({ type: m.media_type, name: { audio: 'Áudio', image: 'Imagem', file: 'Arquivo', link: m.media_url }[m.media_type] || 'Mídia' })}</div>` : ''}
          ${m.error ? `<div class="schedmsg-err">⚠ ${escapeHtml(m.error)}</div>` : ''}
        </div>
        <span class="schedmsg-when">${fmtSchedWhen(m.send_at)}</span>
        ${m.status === 'pending'
          ? `<button class="task-row-del" data-schedmsg-del="${m.id}" title="Cancelar"><svg><use href="#i-trash"/></svg></button>`
          : ''}
      </div>`;
    }).join('');
  }

  async function loadAutomations() {
    const { data } = await supabase.from('automations')
      .select('*').eq('project_id', state.projectId)
      .order('created_at', { ascending: true });
    state.automations = data || [];
  }

  // ─── Mídia: gravação de áudio, imagem, arquivo e link ───
  let _rec = { recorder: null, chunks: [], stream: null };
  function fileToDataURL(file, cb) {
    const r = new FileReader();
    r.onload = e => cb(e.target.result);
    r.readAsDataURL(file);
  }
  function pickMediaFile(accept, kind, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 12 * 1024 * 1024) { toast('Arquivo muito grande (máx. 12 MB)', 'error'); return; }
      fileToDataURL(f, url => cb({ type: kind, url, name: f.name }));
    };
    inp.click();
  }
  function isRecording() { return _rec.recorder && _rec.recorder.state === 'recording'; }
  async function toggleAudioRecording(onDone, onState) {
    if (isRecording()) { _rec.recorder.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Gravação de áudio não suportada neste navegador', 'error'); return;
    }
    try {
      _rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _rec.chunks = [];
      _rec.recorder = new MediaRecorder(_rec.stream);
      _rec.recorder.ondataavailable = e => { if (e.data && e.data.size) _rec.chunks.push(e.data); };
      _rec.recorder.onstop = () => {
        _rec.stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(_rec.chunks, { type: 'audio/webm' });
        fileToDataURL(blob, url => onDone({ type: 'audio', url, name: 'Áudio gravado' }));
        if (onState) onState(false);
      };
      _rec.recorder.start();
      if (onState) onState(true);
      toast('🎙️ Gravando — clique de novo para parar', 'success');
    } catch (e) {
      toast('Não foi possível acessar o microfone', 'error');
    }
  }
  function mediaLabel(m) {
    if (!m) return '';
    const ic = { audio: '🎤', image: '🖼️', file: '📎', link: '🔗' }[m.type] || '📎';
    return `${ic} ${escapeHtml(m.name || m.url || m.type)}`;
  }

  // Tipos de automação
  const AUTO_KINDS = [
    { id: 'automacao', label: 'Automação', ic: '⚡' },
    { id: 'boasvindas', label: 'Boas-vindas', ic: '👋' },
    { id: 'followup', label: 'Follow-up', ic: '📲' },
    { id: 'nutricao', label: 'Nutrição', ic: '🌱' },
    { id: 'reativacao', label: 'Reativação', ic: '♻️' },
    { id: 'posvenda', label: 'Pós-venda', ic: '🎁' },
    { id: 'cobranca', label: 'Cobrança', ic: '💳' },
    { id: 'lembrete', label: 'Lembrete', ic: '🔔' }
  ];
  function autoKindMeta(k) { return AUTO_KINDS.find(x => x.id === k) || AUTO_KINDS[0]; }

  function renderAutomacoes() {
    if (!state.auto2Tab) state.auto2Tab = 'custom';
    showAuto2Tab(state.auto2Tab);
  }
  function showAuto2Tab(tab) {
    state.auto2Tab = tab;
    $$('#auto2-tabs .auto2-tab').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
    $('auto2-custom').style.display = tab === 'custom' ? '' : 'none';
    $('auto-reminders').style.display = tab === 'reminders' ? '' : 'none';
    $('auto-scheduled').style.display = tab === 'scheduled' ? '' : 'none';
    if (tab === 'custom') renderAutoTable();
    else if (tab === 'reminders') loadAutomationSettings();
    else if (tab === 'scheduled') renderSchedMsgList();
  }

  // Tabela organizada de automações
  function renderAutoTable() {
    const tb = $('auto-table-body');
    if (!tb) return;
    if (!state.automations.length) {
      tb.innerHTML = `<tr><td colspan="8"><div class="empty-state">
        <div class="empty-state-title">Nenhuma automação criada</div>
        <div class="empty-state-text">Clique em "Nova automação" para montar seu primeiro fluxo.</div>
      </div></td></tr>`;
      return;
    }
    const trigLabels = {
      pipeline_enter: 'Entra numa etapa', message_received: 'Recebe mensagem',
      keyword_reply: 'Palavra-chave', schedule: 'Em um horário'
    };
    tb.innerHTML = state.automations.map(a => {
      const km = autoKindMeta(a.kind);
      const creator = a.created_by ? profileById(a.created_by) : null;
      return `<tr data-auto-row="${a.id}">
        <td><div class="auto-row-name">${escapeHtml(a.name || 'Sem nome')}</div>
          <div class="auto-row-sub">${(a.steps || []).length} bloco(s)</div></td>
        <td><span class="auto-kind-chip">${km.ic} ${escapeHtml(km.label)}</span></td>
        <td>${trigLabels[a.trigger_type] || '—'}</td>
        <td><button class="auto-toggle ${a.active ? 'on' : 'off'}" data-auto-toggle="${a.id}" title="${a.active ? 'Ativa — clique para pausar' : 'Pausada — clique para ativar'}"><span class="auto-toggle-knob"></span></button></td>
        <td style="font-variant-numeric:tabular-nums">${a.run_count || 0}</td>
        <td>${creator ? escapeHtml(profileName(creator)) : '—'}</td>
        <td style="color:var(--text-muted)">${a.created_at ? relativeTime(a.created_at) : '—'}</td>
        <td>
          <div class="row-actions" style="justify-content:flex-end">
            <button class="row-action" data-auto-edit="${a.id}" title="Editar"><svg><use href="#i-edit"/></svg></button>
            <button class="row-action" data-auto-dup="${a.id}" title="Duplicar"><svg><use href="#i-report"/></svg></button>
            <button class="row-action danger" data-auto-del="${a.id}" title="Excluir"><svg><use href="#i-trash"/></svg></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  async function toggleAutomation(id) {
    const a = state.automations.find(x => x.id === id);
    if (!a) return;
    a.active = !a.active;
    renderAutoTable();
    const { error } = await supabase.from('automations').update({ active: a.active }).eq('id', id);
    if (error) { a.active = !a.active; renderAutoTable(); toast('Erro: ' + error.message, 'error'); }
    else toast(a.active ? 'Automação ativada' : 'Automação pausada', 'success');
  }
  async function duplicateAutomation(id) {
    const a = state.automations.find(x => x.id === id);
    if (!a) return;
    const { error } = await supabase.from('automations').insert({
      name: (a.name || 'Automação') + ' (cópia)', kind: a.kind || 'automacao',
      trigger_type: a.trigger_type, trigger_config: a.trigger_config,
      steps: a.steps, edges: a.edges, active: false, created_by: state.user.id,
      project_id: state.projectId
    });
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadAutomations();
    renderAutoTable();
    toast('Automação duplicada', 'success');
  }
  function openAutomationBuilder(id) {
    $('auto-builder-backdrop').classList.add('show');
    renderAutomationBuilder(id || 'new');
  }

  function renderAutoTriggerConfig(type, cfg) {
    const el = $('auto-trigger-config');
    if (!el) return;
    cfg = cfg || {};
    if (type === 'pipeline_enter') {
      el.innerHTML = `<div class="field-block"><label class="field-block-label">Etapa do pipeline</label>
        <select class="input-text" id="auto-tc-stage">${state.pipeline.map(s =>
          `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select></div>`;
      if (cfg.stage) $('auto-tc-stage').value = cfg.stage;
    } else if (type === 'keyword_reply') {
      el.innerHTML = `<div class="field-block"><label class="field-block-label">Palavra-chave na resposta do lead</label>
        <input type="text" class="input-text" id="auto-tc-keyword" value="${escapeHtml(cfg.keyword || '')}" placeholder="Ex: sim, quero, agendar"></div>`;
    } else if (type === 'schedule') {
      el.innerHTML = `<div class="field-block"><label class="field-block-label">Horário do disparo</label>
        <input type="time" class="input-text" id="auto-tc-time" value="${escapeHtml(cfg.time || '09:00')}"></div>`;
    } else {
      el.innerHTML = `<div class="field-hint">Dispara sempre que o lead enviar qualquer mensagem.</div>`;
    }
  }
  function readTriggerConfig(type) {
    if (type === 'pipeline_enter') return { stage: ($('auto-tc-stage') || {}).value || '' };
    if (type === 'keyword_reply') return { keyword: (($('auto-tc-keyword') || {}).value || '').trim() };
    if (type === 'schedule') return { time: ($('auto-tc-time') || {}).value || '09:00' };
    return {};
  }

  function makeStepEl(s) {
    const div = document.createElement('div');
    div.className = 'autostep';
    div.dataset.type = s.type;
    let title, body, col = false;
    if (s.type === 'wait') {
      title = '⏱ Esperar';
      body = `<input type="number" class="input-text autostep-min" value="${s.minutes || 60}" min="1" style="width:90px">
        <span style="font-size:12.5px;color:var(--text-muted)">minutos</span>`;
    } else if (s.type === 'tag') {
      title = '🏷️ Adicionar tag ao lead';
      body = `<input type="text" class="input-text autostep-tag" value="${escapeHtml(s.tag || '')}" placeholder="Nome da tag (ex: interessado)">`;
    } else if (s.type === 'pipeline') {
      title = '📊 Mover no pipeline';
      body = `<select class="input-text autostep-stage">${state.pipeline.map(st =>
        `<option value="${st.id}">${escapeHtml(st.label)}</option>`).join('')}</select>`;
    } else if (s.type === 'webhook') {
      title = '🔗 Enviar webhook';
      body = `<input type="text" class="input-text autostep-url" value="${escapeHtml(s.url || '')}" placeholder="https://... (POST com os dados do lead)">`;
    } else {
      title = '💬 Enviar mensagem';
      col = true;
      body = `<textarea class="notes-textarea autostep-text" placeholder="Texto da mensagem... use {nome}">${escapeHtml(s.text || '')}</textarea>
        <input type="text" class="input-text autostep-tpl" value="${escapeHtml(s.template || '')}" placeholder="Template aprovado (usado fora da janela de 24h)" style="margin-top:7px">
        <div class="autostep-hint">Dentro da janela de 24h vai o texto livre. Fora dela, o WhatsApp exige um <strong>template aprovado</strong> — informe o nome dele acima.</div>`;
    }
    div.innerHTML = `<div class="autostep-hd"><span class="autostep-drag">⠿</span>
      <span class="autostep-tt">${title}</span>
      <button class="autostep-del" type="button">✕</button></div>
      <div class="autostep-bd${col ? ' autostep-bd-col' : ''}">${body}</div>`;
    if (s.type === 'pipeline' && s.stage) {
      const sel = div.querySelector('.autostep-stage');
      if (sel) sel.value = s.stage;
    }
    div.querySelector('.autostep-del').addEventListener('click', () => div.remove());
    return div;
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONSTRUTOR VISUAL DE FLUXO (drag-and-drop)
  // ═══════════════════════════════════════════════════════════════════
  const FLOW_NODE_META = {
    trigger:  { ic: '⚡', label: 'Gatilho' },
    message:  { ic: '💬', label: 'Enviar mensagem' },
    wait:     { ic: '⏱', label: 'Esperar' },
    tag:      { ic: '🏷️', label: 'Adicionar tag' },
    pipeline: { ic: '📊', label: 'Mover no pipeline' },
    webhook:  { ic: '🔗', label: 'Enviar webhook' }
  };
  let flowDrag = null;   // arraste de nó em andamento
  let flowLink = null;   // criação de conexão em andamento
  function flowGenId() { return 'n' + Math.random().toString(36).slice(2, 8); }

  // Monta os nós/conexões a partir da automação
  function flowInit(a) {
    const nodes = [{
      id: 'trigger', type: 'trigger',
      x: (a.trigger_x != null ? a.trigger_x : 60), y: 30,
      trigger_type: a.trigger_type || 'pipeline_enter',
      trigger_config: a.trigger_config || {}
    }];
    (a.steps || []).forEach((s, i) => {
      nodes.push({
        id: s.id || flowGenId(), type: s.type,
        x: s.x != null ? s.x : 60, y: s.y != null ? s.y : 210 + i * 160,
        text: s.text, template: s.template, minutes: s.minutes,
        tag: s.tag, stage: s.stage, url: s.url, media: s.media || null
      });
    });
    let edges = Array.isArray(a.edges) && a.edges.length ? a.edges.map(e => ({ ...e })) : [];
    if (!edges.length) {
      for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
    }
    state.flow = { nodes, edges };
  }

  function flowTriggerConfigHTML(type, cfg) {
    cfg = cfg || {};
    if (type === 'pipeline_enter') {
      return `<select class="flow-tc-stage input-text">${state.pipeline.map(s =>
        `<option value="${s.id}"${s.id === cfg.stage ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select>`;
    }
    if (type === 'keyword_reply') {
      return `<input class="flow-tc-keyword input-text" placeholder="palavra-chave" value="${escapeHtml(cfg.keyword || '')}">`;
    }
    if (type === 'schedule') {
      return `<input type="time" class="flow-tc-time input-text" value="${escapeHtml(cfg.time || '09:00')}">`;
    }
    return '<div class="flow-tc-note">Dispara com qualquer mensagem do lead.</div>';
  }
  function flowReadTriggerConfig(el, type) {
    if (type === 'pipeline_enter') { const s = el.querySelector('.flow-tc-stage'); return { stage: s ? s.value : '' }; }
    if (type === 'keyword_reply') { const s = el.querySelector('.flow-tc-keyword'); return { keyword: s ? s.value.trim() : '' }; }
    if (type === 'schedule') { const s = el.querySelector('.flow-tc-time'); return { time: s ? s.value : '09:00' }; }
    return {};
  }

  function flowNodeEl(node) {
    const meta = FLOW_NODE_META[node.type] || FLOW_NODE_META.message;
    const div = document.createElement('div');
    div.className = 'flow-node flow-node-' + node.type;
    div.dataset.nodeId = node.id;
    div.dataset.nodeType = node.type;
    div.style.left = (node.x || 40) + 'px';
    div.style.top = (node.y || 40) + 'px';
    let body = '';
    if (node.type === 'trigger') {
      body = `<select class="flow-trigger-type input-text">
          <option value="pipeline_enter">Entra numa etapa</option>
          <option value="message_received">Recebe uma mensagem</option>
          <option value="keyword_reply">Responde palavra-chave</option>
          <option value="schedule">Em um horário</option>
        </select><div class="flow-tc">${flowTriggerConfigHTML(node.trigger_type, node.trigger_config || {})}</div>`;
    } else if (node.type === 'message') {
      body = `<textarea class="flow-f-text" rows="2" placeholder="Mensagem... use {nome}">${escapeHtml(node.text || '')}</textarea>
        <input class="flow-f-tpl input-text" placeholder="Template (fora da janela 24h)" value="${escapeHtml(node.template || '')}">
        <div class="flow-media">
          <div class="flow-media-bar">
            <button type="button" class="flow-media-btn" data-mb="audio" title="Gravar áudio">🎤</button>
            <button type="button" class="flow-media-btn" data-mb="image" title="Anexar imagem">🖼️</button>
            <button type="button" class="flow-media-btn" data-mb="file" title="Anexar arquivo">📎</button>
            <button type="button" class="flow-media-btn" data-mb="link" title="Adicionar link">🔗</button>
          </div>
          <div class="flow-media-preview"></div>
        </div>`;
    } else if (node.type === 'wait') {
      body = `<input type="number" class="flow-f-min input-text" value="${node.minutes || 60}" min="1">
        <span class="flow-unit">minutos</span>`;
    } else if (node.type === 'tag') {
      body = `<input class="flow-f-tag input-text" placeholder="Nome da tag" value="${escapeHtml(node.tag || '')}">`;
    } else if (node.type === 'pipeline') {
      body = `<select class="flow-f-stage input-text">${state.pipeline.map(s =>
        `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}</select>`;
    } else if (node.type === 'webhook') {
      body = `<input class="flow-f-url input-text" placeholder="https://..." value="${escapeHtml(node.url || '')}">`;
    }
    div.innerHTML =
      (node.type !== 'trigger' ? '<div class="flow-port flow-port-in"></div>' : '') +
      `<div class="flow-node-hd"><span class="flow-node-ic">${meta.ic}</span>
        <span class="flow-node-tt">${meta.label}</span>
        ${node.type !== 'trigger' ? '<button class="flow-node-del" type="button">✕</button>' : ''}</div>
      <div class="flow-node-bd">${body}</div>
      <div class="flow-port flow-port-out" title="Arraste para ligar a outro bloco"></div>`;
    if (node.type === 'trigger') {
      const ts = div.querySelector('.flow-trigger-type');
      ts.value = node.trigger_type || 'pipeline_enter';
      ts.addEventListener('change', () => {
        div.querySelector('.flow-tc').innerHTML = flowTriggerConfigHTML(ts.value, {});
      });
    }
    if (node.type === 'pipeline' && node.stage) {
      const ss = div.querySelector('.flow-f-stage'); if (ss) ss.value = node.stage;
    }
    if (node.type === 'message') {
      const prev = div.querySelector('.flow-media-preview');
      const renderPrev = () => {
        prev.innerHTML = node.media
          ? `<span class="flow-media-chip">${mediaLabel(node.media)}<button type="button" class="flow-media-x">✕</button></span>`
          : '';
        const x = prev.querySelector('.flow-media-x');
        if (x) x.addEventListener('click', () => { node.media = null; renderPrev(); });
      };
      renderPrev();
      div.querySelectorAll('.flow-media-btn').forEach(b => {
        b.addEventListener('click', () => {
          const k = b.dataset.mb;
          if (k === 'audio') {
            toggleAudioRecording(m => { node.media = m; renderPrev(); },
              rec => b.classList.toggle('recording', rec));
          } else if (k === 'image') {
            pickMediaFile('image/*', 'image', m => { node.media = m; renderPrev(); });
          } else if (k === 'file') {
            pickMediaFile('*/*', 'file', m => { node.media = m; renderPrev(); });
          } else if (k === 'link') {
            const u = prompt('Cole o link a enviar:');
            if (u && u.trim()) { node.media = { type: 'link', url: u.trim(), name: u.trim() }; renderPrev(); }
          }
        });
      });
    }
    div.querySelector('.flow-node-hd').addEventListener('mousedown', e => {
      if (e.target.closest('.flow-node-del')) return;
      e.preventDefault();
      flowDrag = { el: div, sx: e.clientX, sy: e.clientY, ox: div.offsetLeft, oy: div.offsetTop };
    });
    const del = div.querySelector('.flow-node-del');
    if (del) del.addEventListener('click', () => {
      state.flow.nodes = state.flow.nodes.filter(n => n.id !== node.id);
      state.flow.edges = state.flow.edges.filter(ed => ed.from !== node.id && ed.to !== node.id);
      renderFlow();
    });
    div.querySelector('.flow-port-out').addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      flowLink = { from: node.id };
    });
    return div;
  }

  function flowEdgePath(x1, y1, x2, y2, cls) {
    const dy = Math.max(36, Math.abs(y2 - y1) / 2);
    return `<path class="${cls}" d="M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}"/>`;
  }
  function flowDrawEdges(tx, ty) {
    const svg = $('flow-edges'), canvas = $('flow-canvas');
    if (!svg || !canvas) return;
    let h = '';
    state.flow.edges.forEach((ed, i) => {
      const a = canvas.querySelector(`.flow-node[data-node-id="${ed.from}"]`);
      const b = canvas.querySelector(`.flow-node[data-node-id="${ed.to}"]`);
      if (!a || !b) return;
      h += flowEdgePath(a.offsetLeft + a.offsetWidth / 2, a.offsetTop + a.offsetHeight,
        b.offsetLeft + b.offsetWidth / 2, b.offsetTop, 'flow-edge" data-edge="' + i);
    });
    if (flowLink && tx != null) {
      const a = canvas.querySelector(`.flow-node[data-node-id="${flowLink.from}"]`);
      if (a) h += flowEdgePath(a.offsetLeft + a.offsetWidth / 2, a.offsetTop + a.offsetHeight, tx, ty, 'flow-edge flow-edge-temp');
    }
    svg.innerHTML = h;
  }

  function renderFlow() {
    const canvas = $('flow-canvas');
    if (!canvas) return;
    canvas.querySelectorAll('.flow-node').forEach(n => n.remove());
    state.flow.nodes.forEach(n => canvas.appendChild(flowNodeEl(n)));
    flowDrawEdges();
  }

  function flowAddNode(type) {
    const k = state.flow.nodes.length;
    const n = { id: flowGenId(), type, x: 90 + (k % 3) * 30, y: 150 + k * 40 };
    if (type === 'wait') n.minutes = 60;
    state.flow.nodes.push(n);
    renderFlow();
  }

  function renderAutomationBuilder(id) {
    let a;
    const existing = state.automations.find(x => x.id === id);
    if (id === 'new' || !existing) {
      a = { id: 'new', name: '', trigger_type: 'pipeline_enter', trigger_config: {}, steps: [], edges: [], active: false };
    } else {
      a = JSON.parse(JSON.stringify(existing));
    }
    state.editingAutomation = a;
    flowInit(a);
    $('auto-builder-title').textContent = a.id === 'new' ? 'Nova automação' : 'Editar automação';
    const builder = $('autopanel-builder');
    builder.innerHTML = `
      <div class="auto-builder-form">
        <div class="field-block">
          <label class="field-block-label">Nome da automação</label>
          <input type="text" class="input-text" id="auto-name" placeholder="Ex: Boas-vindas ao novo lead">
        </div>
        <div class="field-block">
          <label class="field-block-label">Tipo</label>
          <select class="input-text" id="auto-kind">
            ${AUTO_KINDS.map(k => `<option value="${k.id}">${k.ic} ${escapeHtml(k.label)}</option>`).join('')}
          </select>
        </div>
        <label class="perm-check auto-builder-active">
          <input type="checkbox" id="auto-active"><span>Automação ativa</span>
        </label>
      </div>
      <div class="flow-palette">
        <span class="flow-palette-lb">Adicionar bloco:</span>
        <button class="flow-add-btn" type="button" data-add="message">💬 Mensagem</button>
        <button class="flow-add-btn" type="button" data-add="wait">⏱ Esperar</button>
        <button class="flow-add-btn" type="button" data-add="tag">🏷️ Tag</button>
        <button class="flow-add-btn" type="button" data-add="pipeline">📊 Pipeline</button>
        <button class="flow-add-btn" type="button" data-add="webhook">🔗 Webhook</button>
        <div class="flow-palette-actions">
          ${a.id !== 'new'
            ? '<button class="modal-btn modal-btn-danger" id="auto-delete" type="button"><svg><use href="#i-trash"/></svg>Excluir</button>'
            : ''}
          <button class="btn-primary" id="auto-save" type="button"><svg><use href="#i-check"/></svg> Salvar automação</button>
        </div>
      </div>
      <div class="flow-canvas-wrap">
        <div class="flow-canvas" id="flow-canvas"><svg class="flow-edges" id="flow-edges"></svg></div>
      </div>
    `;
    $('auto-name').value = a.name || '';
    $('auto-kind').value = a.kind || 'automacao';
    $('auto-active').checked = !!a.active;
    renderFlow();
    $$('.flow-add-btn').forEach(b => b.addEventListener('click', () => flowAddNode(b.dataset.add)));
    $('flow-edges').addEventListener('click', e => {
      const p = e.target.closest('[data-edge]');
      if (p) { state.flow.edges.splice(Number(p.dataset.edge), 1); flowDrawEdges(); }
    });
    $('auto-save').addEventListener('click', saveAutomation);
    const del = $('auto-delete');
    if (del) del.addEventListener('click', () => deleteAutomation(a.id));
  }

  async function saveAutomation() {
    const a = state.editingAutomation;
    const name = $('auto-name').value.trim();
    if (!name) { toast('Dê um nome à automação', 'error'); return; }
    // Lê os nós do canvas
    let triggerType = 'pipeline_enter', triggerConfig = {};
    const steps = [];
    $$('#flow-canvas .flow-node').forEach(el => {
      const id = el.dataset.nodeId, type = el.dataset.nodeType;
      const x = el.offsetLeft, y = el.offsetTop;
      if (type === 'trigger') {
        triggerType = el.querySelector('.flow-trigger-type').value;
        triggerConfig = flowReadTriggerConfig(el, triggerType);
        return;
      }
      const node = { id, type, x, y };
      if (type === 'message') {
        node.text = el.querySelector('.flow-f-text').value;
        node.template = el.querySelector('.flow-f-tpl').value.trim();
        const fn = state.flow.nodes.find(n => n.id === id);
        if (fn && fn.media) node.media = fn.media;
      } else if (type === 'wait') {
        node.minutes = Number(el.querySelector('.flow-f-min').value) || 0;
      } else if (type === 'tag') {
        node.tag = el.querySelector('.flow-f-tag').value.trim();
      } else if (type === 'pipeline') {
        node.stage = el.querySelector('.flow-f-stage').value;
      } else if (type === 'webhook') {
        node.url = el.querySelector('.flow-f-url').value.trim();
      }
      steps.push(node);
    });
    const payload = {
      name, kind: $('auto-kind').value || 'automacao',
      trigger_type: triggerType, trigger_config: triggerConfig,
      steps, edges: state.flow.edges, active: $('auto-active').checked
    };
    const btn = $('auto-save');
    btn.disabled = true;
    let error;
    if (a.id === 'new') {
      payload.created_by = state.user.id;
      payload.project_id = state.projectId;
      ({ error } = await supabase.from('automations').insert(payload));
    } else {
      ({ error } = await supabase.from('automations').update(payload).eq('id', a.id));
    }
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadAutomations();
    $('auto-builder-backdrop').classList.remove('show');
    renderAutoTable();
    toast('Automação salva', 'success');
  }

  async function deleteAutomation(id) {
    if (id === 'new') { $('auto-builder-backdrop').classList.remove('show'); return; }
    if (!confirm('Excluir esta automação?')) return;
    const { error } = await supabase.from('automations').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.automations = state.automations.filter(x => x.id !== id);
    $('auto-builder-backdrop').classList.remove('show');
    renderAutoTable();
    toast('Automação excluída', 'success');
  }

  function openSchedMsgModal(presetLeadId) {
    const sel = $('schedmsg-lead');
    sel.innerHTML = '<option value="">— Selecione um lead —</option>' +
      state.leads.map(l =>
        `<option value="${l.id}">${escapeHtml((l.nome || 'Lead') + (l.telefone ? ' · ' + l.telefone : ''))}</option>`
      ).join('');
    sel.value = presetLeadId || '';
    $('schedmsg-date').value = ymd(new Date());
    $('schedmsg-time').value = '09:00';
    $('schedmsg-body').value = '';
    state.schedMedia = null;
    renderSchedMediaPreview();
    $('schedmsg-modal-backdrop').classList.add('show');
  }
  function renderSchedMediaPreview() {
    const el = $('sm-media-preview');
    if (!el) return;
    el.innerHTML = state.schedMedia
      ? `<span class="flow-media-chip">${mediaLabel(state.schedMedia)}<button type="button" class="flow-media-x" id="sm-media-clear">✕</button></span>`
      : '';
    const x = $('sm-media-clear');
    if (x) x.addEventListener('click', () => { state.schedMedia = null; renderSchedMediaPreview(); });
  }

  async function saveSchedMsg() {
    const leadId = $('schedmsg-lead').value;
    const date = $('schedmsg-date').value;
    const time = $('schedmsg-time').value;
    const body = $('schedmsg-body').value.trim();
    if (!leadId) { toast('Selecione um lead', 'error'); return; }
    if (!date || !time) { toast('Preencha data e hora', 'error'); return; }
    if (!body && !state.schedMedia) { toast('Escreva uma mensagem ou anexe uma mídia', 'error'); return; }
    const send_at = new Date(`${date}T${time}`).toISOString();
    const btn = $('schedmsg-save');
    btn.disabled = true;
    const { error } = await supabase.from('scheduled_messages').insert({
      vendedor_id: state.user.id, lead_id: leadId, body, send_at,
      media_url: state.schedMedia ? state.schedMedia.url : null,
      media_type: state.schedMedia ? state.schedMedia.type : null
    });
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadScheduledMessages();
    renderSchedMsgList();
    closeAllModals();
    toast('Mensagem agendada', 'success');
  }

  async function deleteSchedMsg(id) {
    if (!confirm('Cancelar esta mensagem agendada?')) return;
    const { error } = await supabase.from('scheduled_messages').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.scheduledMessages = state.scheduledMessages.filter(m => m.id !== id);
    renderSchedMsgList();
    toast('Mensagem cancelada', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // PLAYBOOK
  // ═══════════════════════════════════════════════════════════════════
  function renderPlaybook() {
    const tabs = window.PLAYBOOK_CONTENT || [];
    const tabsEl = $('playbook-tabs');
    const contentEl = $('playbook-content');
    if (!tabsEl || !contentEl) return;
    if (!tabs.length) {
      contentEl.innerHTML = '<div class="empty-state"><div class="empty-state-text">Playbook indisponível.</div></div>';
      return;
    }
    if (!tabs.find(t => t.id === state.playbookTab)) state.playbookTab = tabs[0].id;
    tabsEl.innerHTML = '<div class="playbook-nav-head"><span class="playbook-nav-dot"></span>Playbook de Vendas</div>' +
      tabs.map((t, i) =>
        `<button class="playbook-tab ${t.id === state.playbookTab ? 'active' : ''}" data-ptab="${t.id}">
           <span class="playbook-tab-ic">${t.icon || '📄'}</span>
           <span class="playbook-tab-lb">${escapeHtml(t.label)}</span>
           <span class="playbook-tab-nb">${i + 1}</span>
         </button>`
      ).join('');
    const active = tabs.find(t => t.id === state.playbookTab) || tabs[0];
    const idx = tabs.findIndex(t => t.id === active.id);
    // Conteúdo é estático e confiável (definido em playbook.js) — innerHTML é seguro aqui
    contentEl.innerHTML = `
      <div class="playbook-hero">
        <span class="playbook-hero-ic">${active.icon || '📄'}</span>
        <div>
          <div class="playbook-hero-kicker">Capítulo ${idx + 1} de ${tabs.length} · Playbook MyLion</div>
          <h2 class="playbook-hero-title">${escapeHtml(active.label)}</h2>
        </div>
      </div>
      <div class="playbook-doc">${active.html}</div>`;
    contentEl.scrollTop = 0;
  }

  // Mapa: chave do submenu → id da seção no DOM
  const SETTINGS_SECTIONS = {
    profile: 'settings-profile',
    pipeline: 'settings-pipeline',
    vendors: 'settings-vendors',
    whatsapp: 'settings-whatsapp',
    google: 'settings-google',
    capture: 'settings-capture'
  };

  // ─── Captação de leads (canais) ───
  async function loadCaptureChannels() {
    const { data } = await supabase.from('capture_channels')
      .select('*').eq('project_id', state.projectId)
      .order('created_at', { ascending: true });
    state.captureChannels = data || [];
  }
  function captureEndpoint() {
    return CONFIG.SUPABASE_URL + '/functions/v1/lead-capture';
  }
  function renderCaptureChannels() {
    const ep = $('capture-endpoint');
    if (ep) ep.textContent = captureEndpoint();
    const list = $('capture-list');
    if (!list) return;
    if (!state.captureChannels.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">
        Nenhum canal de captação ainda. Clique em "Novo canal".</div></div>`;
      return;
    }
    list.innerHTML = state.captureChannels.map(c => {
      const leadCount = state.leads.filter(l =>
        l.origem === 'Captação: ' + c.name).length;
      return `<div class="capture-card ${c.active ? '' : 'off'}">
        <div class="capture-card-main">
          <div class="capture-card-name">
            ${escapeHtml(c.name)}
            <span class="capture-src">${sourceMeta(c.source_type).icon} ${escapeHtml(sourceMeta(c.source_type).label)}</span>
          </div>
          <div class="capture-card-slug">slug: <code>${escapeHtml(c.slug)}</code> · ${leadCount} lead(s)</div>
          <div class="capture-snippet">curl -X POST ${captureEndpoint()} -H "Content-Type: application/json" -d '{"channel":"${escapeHtml(c.slug)}","lead":{"nome":"...","telefone":"..."}}'</div>
        </div>
        <div class="capture-card-actions">
          <button class="auto-toggle ${c.active ? 'on' : 'off'}" data-ch-toggle="${c.id}" title="${c.active ? 'Ativo' : 'Inativo'}"><span class="auto-toggle-knob"></span></button>
          <button class="row-action" data-ch-copy="${c.id}" title="Copiar payload de exemplo"><svg><use href="#i-report"/></svg></button>
          <button class="row-action danger" data-ch-del="${c.id}" title="Excluir canal"><svg><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }
  function openChannelModal() {
    $('channel-name').value = '';
    $('channel-source').value = 'outro';
    $('channel-active').checked = true;
    $('channel-modal-backdrop').classList.add('show');
    setTimeout(() => $('channel-name').focus(), 60);
  }
  function slugify(s) {
    return (String(s || '').toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28)) || 'canal';
  }
  async function saveChannel() {
    const name = $('channel-name').value.trim();
    if (!name) { toast('Dê um nome ao canal', 'error'); return; }
    const slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 6);
    const btn = $('channel-save');
    btn.disabled = true;
    const { error } = await supabase.from('capture_channels').insert({
      project_id: state.projectId, name, slug,
      source_type: $('channel-source').value || 'outro',
      active: $('channel-active').checked
    });
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadCaptureChannels();
    renderCaptureChannels();
    $('channel-modal-backdrop').classList.remove('show');
    toast('Canal de captação criado', 'success');
  }
  async function toggleChannel(id) {
    const c = state.captureChannels.find(x => x.id === id);
    if (!c) return;
    c.active = !c.active;
    renderCaptureChannels();
    const { error } = await supabase.from('capture_channels')
      .update({ active: c.active }).eq('id', id);
    if (error) { c.active = !c.active; renderCaptureChannels(); toast('Erro: ' + error.message, 'error'); }
  }
  async function deleteChannel(id) {
    if (!confirm('Excluir este canal de captação? O endpoint deixa de funcionar.')) return;
    const { error } = await supabase.from('capture_channels').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.captureChannels = state.captureChannels.filter(c => c.id !== id);
    renderCaptureChannels();
    toast('Canal excluído', 'success');
  }

  function showSettingsSection(section) {
    if (!SETTINGS_SECTIONS[section]) section = 'profile';
    state.settingsSection = section;
    $$('#settings-nav .settings-nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.section === section));
    Object.entries(SETTINGS_SECTIONS).forEach(([sec, id]) => {
      const el = $(id);
      if (el) el.style.display = (sec === section) ? '' : 'none';
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // NOTIFICAÇÕES
  // ═══════════════════════════════════════════════════════════════════
  async function loadNotifications() {
    const { data } = await supabase.from('notifications')
      .select('*').order('created_at', { ascending: false }).limit(30);
    state.notifications = data || [];
  }

  function renderNotifications() {
    const unread = state.notifications.filter(n => !n.read).length;
    const badge = $('topbar-bell-badge');
    if (badge) {
      if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = ''; }
      else badge.style.display = 'none';
    }
    const list = $('notif-list');
    if (!list) return;
    if (!state.notifications.length) {
      list.innerHTML = '<div class="notif-empty">Nenhuma notificação ainda.</div>';
      return;
    }
    const ic = { task: '📋', pipeline: '🔄', sale: '🎉', automation: '⚡' };
    list.innerHTML = state.notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" data-notif="${n.id}" data-lead="${n.lead_id || ''}">
        <span class="notif-ic">${ic[n.type] || '🔔'}</span>
        <div class="notif-main">
          <div class="notif-title">${escapeHtml(n.title)}</div>
          ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ''}
          <div class="notif-time">${relativeTime(n.created_at)}</div>
        </div>
      </div>`).join('');
  }

  async function markAllNotifsRead() {
    const ids = state.notifications.filter(n => !n.read).map(n => n.id);
    if (!ids.length) return;
    state.notifications.forEach(n => { n.read = true; });
    renderNotifications();
    await supabase.from('notifications').update({ read: true }).in('id', ids);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PROPOSTAS COMERCIAIS
  // ═══════════════════════════════════════════════════════════════════
  const PROPOSAL_DELIVERABLES = [
    'Construção de funil de vendas',
    'Gestão de tráfego pago',
    'Gestão de social media',
    'Criação de criativos',
    'CRM e automações',
    'Treinamento de vendas',
    'Consultoria de vendas',
    'Equipe de vendas'
  ];

  async function loadProposals() {
    const { data, error } = await supabase
      .from('proposals').select('*').eq('project_id', state.projectId)
      .order('created_at', { ascending: false });
    if (error) { console.warn('Proposals falhou', error); state.proposals = []; return; }
    state.proposals = data || [];
  }

  function proposalLink(id) {
    return location.origin + '/proposta.html?id=' + id;
  }

  function renderPropostas() {
    const list = $('propostas-list');
    if (!list) return;
    if (!state.proposals.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-state-text">
        Nenhuma proposta ainda. Clique em "Nova proposta".</div></div>`;
      return;
    }
    const stLabel = { draft: 'Rascunho', accepted: 'Aceita' };
    list.innerHTML = state.proposals.map(p => `
      <div class="proposta-row">
        <div class="proposta-row-main" data-prop-open="${p.id}">
          <div class="proposta-row-title">${escapeHtml(p.client_name)}</div>
          <div class="proposta-row-sub">${escapeHtml(p.client_niche || 'Sem nicho')} · ${(p.deliverables || []).length} entregas</div>
          ${p.status === 'accepted' && p.accepted_data
            ? `<div class="proposta-row-acc">✅ Aceita por ${escapeHtml(p.accepted_data.nome || 'cliente')}</div>` : ''}
        </div>
        <span class="proposta-st proposta-st-${p.status}">${stLabel[p.status] || p.status}</span>
        <button class="proposta-act proposta-act-open" data-prop-view="${p.id}" title="Abrir a apresentação">
          <svg><use href="#i-expand"/></svg></button>
        <button class="proposta-act" data-prop-link="${p.id}" title="Copiar link da apresentação">
          <svg><use href="#i-report"/></svg></button>
        <button class="proposta-act danger" data-prop-del="${p.id}" title="Excluir">
          <svg><use href="#i-trash"/></svg></button>
      </div>`).join('');
  }

  function openProposalModal(id) {
    const p = id ? state.proposals.find(x => x.id === id) : null;
    state.editingProposal = p || null;
    $('proposta-modal-title').textContent = p ? 'Editar proposta' : 'Nova proposta';
    const sel = $('proposta-lead');
    sel.innerHTML = '<option value="">— Nenhum —</option>' +
      state.leads.map(l => `<option value="${l.id}">${escapeHtml(l.nome || 'Lead')}</option>`).join('');
    sel.value = p ? (p.lead_id || '') : '';
    $('proposta-client').value = p ? (p.client_name || '') : '';
    $('proposta-niche').value = p ? (p.client_niche || '') : '';
    $('proposta-context').value = p ? (p.client_context || '') : '';
    $('proposta-payment').value = p ? (p.payment || '') : '';
    $('proposta-setup').value = p && p.setup_fee != null ? p.setup_fee : '';
    $('proposta-monthly').value = p && p.monthly_fee != null ? p.monthly_fee : '';
    $('proposta-months').value = p && p.contract_months != null ? p.contract_months : '';
    $('proposta-transcription').value = p ? (p.transcription || '') : '';
    const cst = (p && p.custom) || {};
    $('proposta-cover-title').value = cst.cover_title || '';
    $('proposta-summary').value = cst.summary || '';
    $('proposta-solution').value = cst.solution || '';
    $('proposta-closing').value = cst.closing || '';
    const chosen = p ? (p.deliverables || []) : PROPOSAL_DELIVERABLES.slice(0, 3);
    $('proposta-delivs').innerHTML = PROPOSAL_DELIVERABLES.map(d =>
      `<label class="perm-check"><input type="checkbox" value="${escapeHtml(d)}" ${chosen.includes(d) ? 'checked' : ''}><span>${escapeHtml(d)}</span></label>`
    ).join('');
    $('proposta-extra').value = chosen.filter(d => !PROPOSAL_DELIVERABLES.includes(d)).join('\n');
    $('proposta-delete').style.display = p ? '' : 'none';
    $('proposta-modal-backdrop').classList.add('show');
  }

  async function saveProposal() {
    const client = $('proposta-client').value.trim();
    const context = $('proposta-context').value.trim();
    if (!client) { toast('Informe o nome do cliente', 'error'); return; }
    if (!context) { toast('Descreva o contexto do cliente', 'error'); return; }
    const delivs = $$('#proposta-delivs input:checked').map(c => c.value);
    const extra = $('proposta-extra').value.split('\n').map(s => s.trim()).filter(Boolean);
    const numOrNull = v => (v !== '' && v != null && !isNaN(v)) ? Number(v) : null;
    const patch = {
      lead_id: $('proposta-lead').value || null,
      client_name: client,
      client_niche: $('proposta-niche').value.trim() || null,
      client_context: context,
      deliverables: delivs.concat(extra),
      payment: $('proposta-payment').value.trim() || null,
      setup_fee: numOrNull($('proposta-setup').value),
      monthly_fee: numOrNull($('proposta-monthly').value),
      contract_months: numOrNull($('proposta-months').value),
      transcription: $('proposta-transcription').value.trim() || null,
      custom: {
        cover_title: $('proposta-cover-title').value.trim() || null,
        summary: $('proposta-summary').value.trim() || null,
        solution: $('proposta-solution').value.trim() || null,
        closing: $('proposta-closing').value.trim() || null
      }
    };
    const editing = state.editingProposal;
    const btn = $('proposta-save');
    btn.disabled = true;
    let saved, error;
    if (editing) {
      ({ data: saved, error } = await supabase.from('proposals').update(patch).eq('id', editing.id).select().single());
    } else {
      patch.vendedor_id = state.user.id;
      patch.project_id = state.projectId;
      ({ data: saved, error } = await supabase.from('proposals').insert(patch).select().single());
    }
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadProposals();
    renderPropostas();
    closeAllModals();
    // Copia o link da apresentação para a área de transferência
    const link = proposalLink(saved.id);
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
    toast('Proposta salva — link da apresentação copiado', 'success');
  }

  async function deleteProposal(id) {
    if (!confirm('Excluir esta proposta?')) return;
    const { error } = await supabase.from('proposals').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.proposals = state.proposals.filter(p => p.id !== id);
    renderPropostas();
    toast('Proposta excluída', 'success');
  }

  function renderSettings() {
    // Meu perfil é sempre renderizado (todos têm acesso ao próprio perfil)
    renderProfileSection();

    const isAdminUser = canSee('settings');

    // Itens admin do submenu só aparecem para admin
    $$('#settings-nav .settings-nav-item').forEach(btn => {
      if (btn.hasAttribute('data-admin')) btn.style.display = isAdminUser ? '' : 'none';
    });

    // Se a seção ativa não é permitida (ex: vendedor em seção admin), volta pro perfil
    const activeBtn = $$('#settings-nav .settings-nav-item')
      .find(b => b.dataset.section === state.settingsSection);
    if (!activeBtn || (activeBtn.hasAttribute('data-admin') && !isAdminUser)) {
      state.settingsSection = 'profile';
    }

    showSettingsSection(state.settingsSection);

    if (isAdminUser) {
      renderPipelineEditor();
      renderVendors();
      loadWhatsAppConfig();
      loadGoogleConfig();
      renderCaptureChannels();
      loadCaptureChannels().then(renderCaptureChannels);
    }
  }

  // ─── Configuração Google / Agenda ───
  async function loadGoogleConfig() {
    const { data, error } = await supabase
      .from('google_config').select('*').eq('id', 1).maybeSingle();
    if (error) { console.warn('Erro google config:', error); return; }
    const c = data || {};

    $('google-enabled').checked = !!c.enabled;
    $('google-client-id').value = c.client_id || '';
    $('google-client-secret').value = c.client_secret || '';
    refreshGoogleStatus();

    const dot = $('google-status-dot');
    const txt = $('google-status-text');
    const hasId = !!c.client_id;
    const hasSecret = !!c.client_secret;
    if (c.enabled && hasId && hasSecret) {
      dot.className = 'wa-status-dot on';
      txt.textContent = 'Credenciais salvas — conecte a conta Google na aba Agenda';
    } else if (hasId || hasSecret) {
      dot.className = 'wa-status-dot partial';
      txt.textContent = 'Configuração incompleta — preencha Client ID e Secret e marque "Integração ativa"';
    } else {
      dot.className = 'wa-status-dot off';
      txt.textContent = 'Não configurado — crie as credenciais no Google Cloud Console';
    }
  }

  async function saveGoogleConfig() {
    const btn = $('btn-save-google');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando';

    const patch = {
      enabled: $('google-enabled').checked,
      client_id: $('google-client-id').value.trim() || null,
      client_secret: $('google-client-secret').value.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: state.user.id
    };

    const { error } = await supabase.from('google_config').update(patch).eq('id', 1);

    btn.disabled = false;
    btn.innerHTML = '<svg><use href="#i-check"/></svg> Salvar';

    if (error) {
      toast('Erro ao salvar: ' + error.message, 'error');
    } else {
      toast('Configuração Google salva', 'success');
      loadGoogleConfig();
    }
  }

  // ─── Configuração WhatsApp API ───
  async function loadWhatsAppConfig() {
    const { data, error } = await supabase
      .from('whatsapp_config').select('*').eq('id', 1).maybeSingle();
    if (error) { console.warn('Erro wa config:', error); return; }
    const c = data || {};

    $('wa-enabled').checked = !!c.enabled;
    $('wa-phone-id').value = c.phone_number_id || '';
    $('wa-business-id').value = c.business_account_id || '';
    $('wa-token').value = c.token || '';
    $('wa-verify-token').value = c.verify_token || '';
    $('wa-tpl-novo-lead').value = c.template_novo_lead || 'novo_lead_mylion';
    $('wa-tpl-iniciar').value = c.template_iniciar_conversa || 'iniciar_conversa';
    $('wa-webhook-url').textContent = CONFIG.SUPABASE_URL + '/functions/v1/whatsapp-webhook';

    // Status
    const dot = $('wa-status-dot');
    const txt = $('wa-status-text');
    const hasToken = !!(c.token);
    const hasPhone = !!(c.phone_number_id);
    if (c.enabled && hasToken && hasPhone) {
      dot.className = 'wa-status-dot on';
      txt.textContent = 'Integração ativa e configurada';
    } else if (hasToken || hasPhone) {
      dot.className = 'wa-status-dot partial';
      txt.textContent = 'Configuração incompleta — preencha todos os campos e marque "Integração ativa"';
    } else {
      dot.className = 'wa-status-dot off';
      txt.textContent = 'Não configurado — preencha os campos abaixo';
    }
  }

  async function saveWhatsAppConfig() {
    const btn = $('btn-save-whatsapp');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando';

    const patch = {
      enabled: $('wa-enabled').checked,
      phone_number_id: $('wa-phone-id').value.trim() || null,
      business_account_id: $('wa-business-id').value.trim() || null,
      token: $('wa-token').value.trim() || null,
      verify_token: $('wa-verify-token').value.trim() || null,
      template_novo_lead: $('wa-tpl-novo-lead').value.trim() || 'novo_lead_mylion',
      template_iniciar_conversa: $('wa-tpl-iniciar').value.trim() || 'iniciar_conversa',
      updated_at: new Date().toISOString(),
      updated_by: state.user.id
    };

    const { error } = await supabase.from('whatsapp_config').update(patch).eq('id', 1);

    btn.disabled = false;
    btn.innerHTML = '<svg><use href="#i-check"/></svg> Salvar';

    if (error) {
      toast('Erro ao salvar: ' + error.message, 'error');
    } else {
      toast('Configuração WhatsApp salva', 'success');
      loadWhatsAppConfig();
    }
  }

  function renderProfileSection() {
    const p = state.profile;
    if (!p) return;

    // Display info
    $('profile-name-display').textContent = p.nome || p.email.split('@')[0];
    $('profile-email-display').textContent = p.email;
    $('profile-role-display').textContent = p.role;

    // Avatar grande (usa foto enviada se houver)
    const avatarEl = $('profile-avatar');
    const av = profileAvatar(p);
    avatarEl.innerHTML = `<img src="${av}" alt="" onerror="this.parentElement.textContent='${initials(p.nome || p.email)}'">`;

    // Form values
    $('profile-nome').value = p.nome || '';
    $('profile-telefone').value = p.telefone || '';
    $('profile-password').value = '';
    if ($('profile-is-seller')) $('profile-is-seller').checked = p.is_seller !== false;
  }

  async function saveProfile() {
    const nome = $('profile-nome').value.trim();
    const telefone = $('profile-telefone').value.trim();
    const password = $('profile-password').value;
    const btn = $('btn-save-profile');

    if (!nome) { toast('Nome não pode ficar vazio', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando';

    try {
      // Atualiza profile (nome, telefone, atua como vendedor)
      const { error: pErr } = await supabase.from('profiles')
        .update({ nome, telefone, is_seller: $('profile-is-seller').checked })
        .eq('id', state.user.id);
      if (pErr) throw pErr;

      // Atualiza senha se preenchida
      if (password) {
        if (password.length < 6) throw new Error('Senha precisa ter no mínimo 6 caracteres');
        const { error: aErr } = await supabase.auth.updateUser({ password });
        if (aErr) throw aErr;
      }

      // Recarrega profile no state
      await loadProfile();

      // Atualiza UI do sidebar
      $('user-name').textContent = state.profile.nome || state.profile.email.split('@')[0];

      // Re-renderiza a section
      renderProfileSection();

      toast('Perfil atualizado', 'success');
    } catch (err) {
      toast('Erro: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg><use href="#i-check"/></svg> Salvar perfil';
    }
  }

  // Upload de foto de perfil — redimensiona no navegador e salva como data URL
  function handleAvatarUpload(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Selecione um arquivo de imagem', 'error'); return; }
    if (file.size > 8 * 1024 * 1024) { toast('Imagem muito grande (máx 8MB)', 'error'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        // Crop central quadrado + redimensiona pra 256x256
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        const { error } = await supabase.from('profiles')
          .update({ avatar_url: dataUrl })
          .eq('id', state.user.id);
        if (error) { toast('Erro ao salvar foto: ' + error.message, 'error'); return; }

        state.profile.avatar_url = dataUrl;
        renderProfileSection();
        // Atualiza avatares do topbar/dropdown na hora
        ['topbar-user-avatar', 'user-dropdown-avatar'].forEach(id => {
          const el = $(id);
          if (el) el.innerHTML = `<img src="${dataUrl}" alt="">`;
        });
        toast('Foto de perfil atualizada', 'success');
      };
      img.onerror = () => toast('Não foi possível ler a imagem', 'error');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function renderPipelineEditor() {
    const ed = $('pipeline-editor');
    ed.innerHTML = state.pipeline.map((stage, idx) => `
      <div class="pipeline-row" data-stage-id="${stage.id}">
        <span class="pipeline-handle"><svg><use href="#i-drag"/></svg></span>
        <input type="color" class="pipeline-color" value="${stage.color}" data-color>
        <input type="text" class="pipeline-name-input" value="${escapeHtml(stage.label)}" maxlength="40" data-label>
        <button class="pipeline-remove" data-remove ${state.pipeline.length <= 3 ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''} title="Remover">
          <svg style="width:14px;height:14px"><use href="#i-trash"/></svg>
        </button>
      </div>
    `).join('');

    // Sortable na lista de etapas
    new Sortable(ed, {
      animation: 150,
      handle: '.pipeline-handle',
      ghostClass: 'sortable-ghost'
    });

    // Wire remove buttons
    ed.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', e => {
        if (state.pipeline.length <= 3) return;
        const row = btn.closest('.pipeline-row');
        row.style.transition = 'all 0.2s'; row.style.opacity = '0'; row.style.transform = 'translateX(-20px)';
        setTimeout(() => row.remove(), 200);
      });
    });
  }

  function readPipelineEditor() {
    const rows = $('pipeline-editor').querySelectorAll('.pipeline-row');
    return Array.from(rows).map((r, idx) => {
      const id = r.dataset.stageId || ('stage_' + Date.now() + '_' + idx);
      const label = r.querySelector('[data-label]').value.trim();
      const color = r.querySelector('[data-color]').value;
      return { id, label, color, order: idx };
    }).filter(s => s.label);
  }

  function renderVendors() {
    const list = $('vendors-list');
    if (state.profiles.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-text">Nenhum vendedor cadastrado ainda.</div></div>';
      return;
    }
    list.innerHTML = state.profiles.map(p => `
      <div class="vendor-row" data-vendor-id="${p.id}">
        <div class="vendor-avatar"><img src="${profileAvatar(p)}" alt="" onerror="this.parentElement.textContent='${initials(p.nome || p.email)}'"></div>
        <div class="vendor-info">
          <div class="vendor-name">${escapeHtml(p.nome || p.email.split('@')[0])} ${p.role === 'admin' ? '<span class="user-role-pill admin" style="margin-left:6px">admin</span>' : ''}</div>
          <div class="vendor-email">${escapeHtml(p.email)} ${p.telefone ? ' · ' + escapeHtml(p.telefone) : ''}</div>
        </div>
        <div class="vendor-actions">
          ${p.id !== state.user.id ? `<button class="row-action danger" data-vendor-delete="${p.id}" title="Remover"><svg><use href="#i-trash"/></svg></button>` : ''}
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-vendor-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteVendor(btn.dataset.vendorDelete));
    });
  }

  async function deleteVendor(id) {
    const p = profileById(id);
    if (!p) return;
    if (!confirm(`Remover ${p.nome || p.email}? O acesso ao CRM será revogado.`)) return;

    // Marca como inativo (não deleta de auth.users, só do profile)
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    state.profiles = state.profiles.filter(p => p.id !== id);
    renderVendors();
    toast('Vendedor removido', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHAT WHATSAPP INTERNO
  // ═══════════════════════════════════════════════════════════════════

  async function loadConversations() {
    const { data, error } = await supabase
      .from('conversations')
      .select('*, leads(id, nome, telefone, instagram, project_id)')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) { console.warn('Erro conversations:', error); return; }
    // Mostra só conversas de leads do projeto atual
    state.conversations = (data || []).filter(c =>
      c.leads && c.leads.project_id === state.projectId);
    updateChatUnreadBadge();
  }

  async function loadMessages(conversationId) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) { console.warn('Erro messages:', error); return; }
    state.messages[conversationId] = data || [];
  }

  function updateChatUnreadBadge() {
    const totalUnread = state.conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    const badge = $('nav-badge-chat');
    if (!badge) return;
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      badge.style.display = '';
      badge.classList.add('unread');
    } else {
      badge.style.display = 'none';
      badge.classList.remove('unread');
    }
  }

  // ─── Render principal do chat ───
  function renderChat() {
    renderChatList();
    const layout = document.querySelector('.chat-layout');
    if (layout) layout.classList.toggle('info-open', !!state.activeConversationId);
    if (state.activeConversationId) {
      renderChatThread();
      renderChatInfo();
    } else {
      $('chat-thread-wrap').style.display = 'none';
      $('chat-empty').style.display = '';
      $('chat-info').style.display = 'none';
    }
  }

  // ─── Painel lateral do negócio (chat) ───
  function renderChatInfo() {
    const panel = $('chat-info');
    if (!panel) return;
    const conv = state.conversations.find(c => c.id === state.activeConversationId);
    if (!conv) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    const basic = conv.leads || {};
    const leadId = conv.lead_id || basic.id;
    const lead = state.leads.find(l => l.id === leadId) || basic;
    state.chatInfoLead = lead;
    state.chatInfoLeadId = leadId;

    $('ci-avatar').innerHTML = `<img src="${avatarUrl(lead.instagram, lead.nome)}" alt="" onerror="${avatarFallback(lead.nome)}">`;
    $('ci-name').textContent = lead.nome || basic.telefone || '—';
    $('ci-sub').textContent = [lead.instagram, lead.telefone || basic.telefone].filter(Boolean).join(' · ') || '—';

    $('ci-status').innerHTML = state.pipeline.map(s =>
      `<option value="${s.id}" ${s.id === lead.pipeline_status ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
    $('ci-vendor').innerHTML = '<option value="">Não atribuído</option>' +
      state.profiles.map(p =>
        `<option value="${p.id}" ${p.id === lead.assigned_to ? 'selected' : ''}>${escapeHtml(profileName(p))}</option>`).join('');
    $('ci-valor').value = lead.valor != null ? lead.valor : '';
    $('ci-notes').value = lead.observacoes || '';

    renderLeadHistory(leadId);
  }

  async function loadLeadHistory(leadId) {
    const { data } = await supabase.from('lead_history')
      .select('*').eq('lead_id', leadId)
      .order('alterado_em', { ascending: false }).limit(20);
    state.leadHistory[leadId] = data || [];
  }

  function renderLeadHistory(leadId) {
    const el = $('ci-history');
    if (!el) return;
    const h = state.leadHistory[leadId];
    if (h === undefined) {
      el.innerHTML = '<div class="ci-hist-empty">Carregando…</div>';
      loadLeadHistory(leadId).then(() => {
        if (state.chatInfoLeadId === leadId) renderLeadHistory(leadId);
      });
      return;
    }
    if (!h.length) {
      el.innerHTML = '<div class="ci-hist-empty">Sem mudanças registradas ainda.</div>';
      return;
    }
    el.innerHTML = h.map(e => {
      const stage = findStage(e.status_novo);
      return `<div class="ci-hist-item">
        <span class="ci-hist-dot" style="background:${stage.color}"></span>
        <div class="ci-hist-main">
          <div class="ci-hist-txt">Movido para <strong>${escapeHtml(stage.label)}</strong></div>
          <div class="ci-hist-meta">${formatDate(e.alterado_em)}${e.alterado_por_email ? ' · ' + escapeHtml(e.alterado_por_email) : ''}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderChatList() {
    const list = $('chat-list');
    const term = state.chatSearchTerm.toLowerCase().trim();

    // Popula o filtro de vendedor uma vez
    const vsel = $('chat-filter-vendor');
    if (vsel && vsel.options.length <= 1) {
      vsel.innerHTML = '<option value="">Todos vendedores</option>' +
        state.profiles.map(p => `<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
    }
    const fUnread = $('chat-filter-unread');
    if (fUnread) fUnread.classList.toggle('active', state.chatFilter.unread);

    let convs = state.conversations.slice();
    // Filtro: não lidas
    if (state.chatFilter.unread) convs = convs.filter(c => (c.unread_count || 0) > 0);
    // Filtro: por vendedor (do lead)
    if (state.chatFilter.vendor) {
      convs = convs.filter(c => {
        const lead = state.leads.find(l => l.id === c.lead_id);
        return lead && lead.assigned_to === state.chatFilter.vendor;
      });
    }
    if (term) {
      convs = convs.filter(c => {
        const lead = c.leads || {};
        return (lead.nome || '').toLowerCase().includes(term) ||
               (lead.instagram || '').toLowerCase().includes(term) ||
               (lead.telefone || '').toLowerCase().includes(term) ||
               (c.last_message_preview || '').toLowerCase().includes(term);
      });
    }

    $('chat-list-count').textContent = `${convs.length} ${convs.length === 1 ? 'ativa' : 'ativas'}`;

    if (convs.length === 0) {
      list.innerHTML = `
        <div class="chat-list-empty">
          ${term ? 'Nenhuma conversa encontrada com este termo.' : 'Nenhuma conversa ainda. Inicie uma pelo botão 💬 do card de um lead.'}
        </div>`;
      return;
    }

    list.innerHTML = convs.map(c => {
      const lead = c.leads || {};
      const av = avatarUrl(lead.instagram, lead.nome);
      const isActive = state.activeConversationId === c.id;
      const unread = c.unread_count || 0;
      const dir = c.last_message_direction === 'in' ? '←' : c.last_message_direction === 'out' ? '→' : '';

      return `
        <div class="chat-list-item ${isActive ? 'active' : ''}" data-conv-id="${c.id}">
          <div class="chat-list-avatar">
            <img src="${av}" alt="" onerror="${avatarFallback(lead.nome)}">
          </div>
          <div class="chat-list-info">
            <div class="chat-list-name">${escapeHtml(lead.nome || lead.telefone || '—')}</div>
            <div class="chat-list-preview">
              ${dir ? `<span style="opacity:0.6">${dir}</span>` : ''}
              ${escapeHtml(c.last_message_preview || 'Sem mensagens ainda')}
            </div>
          </div>
          <div class="chat-list-meta">
            <span class="chat-list-time">${c.last_message_at ? relativeTime(c.last_message_at) : ''}</span>
            ${unread > 0 ? `<span class="chat-unread-pill">${unread > 99 ? '99+' : unread}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.chat-list-item').forEach(el => {
      el.addEventListener('click', () => openChatConversation(el.dataset.convId));
    });
  }

  function renderChatThread() {
    const conv = state.conversations.find(c => c.id === state.activeConversationId);
    if (!conv) {
      $('chat-thread-wrap').style.display = 'none';
      $('chat-empty').style.display = '';
      return;
    }

    $('chat-empty').style.display = 'none';
    $('chat-thread-wrap').style.display = '';

    const lead = conv.leads || {};
    $('chat-thread-name').textContent = lead.nome || lead.telefone || '—';
    $('chat-thread-meta').textContent = `${lead.instagram || ''} · ${lead.telefone || conv.whatsapp_phone}`;

    const av = $('chat-thread-avatar');
    av.innerHTML = `<img src="${avatarUrl(lead.instagram, lead.nome)}" alt="" onerror="${avatarFallback(lead.nome)}">`;

    // Renderiza mensagens
    const msgs = state.messages[conv.id] || [];
    const thread = $('chat-thread');

    if (msgs.length === 0) {
      thread.innerHTML = `<div class="chat-thread-empty">
        Sem mensagens ainda. Envie a primeira mensagem abaixo (usará template se for fora da janela 24h).
      </div>`;
    } else {
      thread.innerHTML = renderThreadMessages(msgs);
    }

    // Aviso de janela 24h
    const warn = $('chat-composer-warn');
    const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
    const within24h = lastInbound > 0 && (Date.now() - lastInbound) < 24 * 60 * 60 * 1000;
    if (!within24h && msgs.length > 0) {
      warn.style.display = '';
      warn.textContent = lastInbound > 0
        ? '⏰ Fora da janela de 24h. Use o botão "Reabrir com template" pra retomar a conversa.'
        : '💬 Lead ainda não respondeu. Primeira mensagem precisa ser um template aprovado.';
    } else {
      warn.style.display = 'none';
    }

    // Scroll pro final
    setTimeout(() => { thread.scrollTop = thread.scrollHeight; }, 30);

    // Marca como lida
    if (conv.unread_count > 0) markConversationRead(conv.id);
  }

  function renderThreadMessages(msgs) {
    let lastDay = '';
    const parts = [];
    msgs.forEach(m => {
      const day = new Date(m.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
      if (day !== lastDay) {
        parts.push(`<div class="chat-day-divider">${day}</div>`);
        lastDay = day;
      }
      parts.push(renderMessageBubble(m));
    });
    return parts.join('');
  }

  function renderMessageBubble(m) {
    const isOut = m.direction === 'out';
    const time = new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const isTemplate = m.message_type === 'template';
    const isFailed = m.status === 'failed';

    let statusIcon = '';
    if (isOut && !isFailed) {
      if (m.status === 'read') {
        statusIcon = `<span class="chat-msg-status-icon read" title="Lida"><svg><use href="#i-check-double"/></svg></span>`;
      } else if (m.status === 'delivered') {
        statusIcon = `<span class="chat-msg-status-icon delivered" title="Entregue"><svg><use href="#i-check"/></svg></span>`;
      } else if (m.status === 'sent') {
        statusIcon = `<span class="chat-msg-status-icon sent" title="Enviada"><svg><use href="#i-check"/></svg></span>`;
      }
    }

    const cls = isOut
      ? (isFailed ? 'chat-msg chat-msg-failed' : (isTemplate ? 'chat-msg chat-msg-template' : 'chat-msg chat-msg-out'))
      : 'chat-msg chat-msg-in';

    let content;
    if (m.message_type === 'text' || m.message_type === 'template') {
      content = `<div class="chat-msg-content">${escapeHtml(m.content || '')}</div>`;
    } else {
      content = `<div class="chat-msg-content" style="font-style:italic;opacity:0.85">[${m.message_type}]${m.content ? ' ' + escapeHtml(m.content) : ''}</div>`;
    }

    return `
      <div class="${cls}">
        ${content}
        <div class="chat-msg-foot">
          ${isTemplate ? '📋 ' : ''}${isFailed ? '⚠ ' + escapeHtml(m.error_message || 'falhou') + ' · ' : ''}${time}
          ${statusIcon}
        </div>
      </div>
    `;
  }

  // ─── Ações ───
  async function openChatConversation(convId) {
    state.activeConversationId = convId;
    if (!state.messages[convId]) {
      await loadMessages(convId);
    }
    renderChat();
  }

  async function openChatForLead(leadId) {
    // Procura conversation pra esse lead
    let conv = state.conversations.find(c => c.leads?.id === leadId || c.lead_id === leadId);

    if (!conv) {
      // Não existe ainda — cria stub localmente; será criada de verdade ao enviar 1ª msg
      const lead = state.leads.find(l => l.id === leadId);
      if (!lead) return;

      // Tenta criar diretamente via supabase
      const phone = String(lead.telefone || '').replace(/\D/g, '');
      if (!phone) { toast('Lead sem telefone válido', 'error'); return; }

      const { data, error } = await supabase
        .from('conversations')
        .insert({ lead_id: leadId, whatsapp_phone: phone })
        .select('*, leads(id, nome, telefone, instagram)')
        .single();

      if (error) {
        // Talvez já exista — recarrega e tenta de novo
        await loadConversations();
        conv = state.conversations.find(c => c.lead_id === leadId);
        if (!conv) {
          toast('Erro ao abrir conversa: ' + error.message, 'error');
          return;
        }
      } else {
        state.conversations.unshift(data);
        conv = data;
      }
    }

    switchView('chat');
    await openChatConversation(conv.id);
  }

  async function markConversationRead(convId) {
    const conv = state.conversations.find(c => c.id === convId);
    if (!conv || conv.unread_count === 0) return;
    conv.unread_count = 0;
    updateChatUnreadBadge();
    await supabase.rpc('mark_conversation_read', { conv_id: convId });
  }

  async function sendChatMessage(content, mode = 'text', templateName = null, templateParams = []) {
    if (!state.activeConversationId) return;
    const conv = state.conversations.find(c => c.id === state.activeConversationId);
    if (!conv) return;

    const input = $('chat-composer-input');
    const sendBtn = $('chat-send-btn');
    sendBtn.disabled = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/whatsapp-send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversation_id: state.activeConversationId,
          content,
          mode,
          template_name: templateName,
          template_params: templateParams
        })
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Falha no envio');

      input.value = '';
      input.style.height = 'auto';

      // A mensagem aparecerá via realtime, mas pra UX rápida adiciona já localmente
      if (json.message) {
        if (!state.messages[state.activeConversationId]) state.messages[state.activeConversationId] = [];
        const exists = state.messages[state.activeConversationId].find(m => m.id === json.message.id);
        if (!exists) state.messages[state.activeConversationId].push(json.message);
        renderChatThread();
      }
    } catch (err) {
      toast('Erro ao enviar: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  }

  function bindChatEvents() {
    // Search
    $('chat-search').addEventListener('input', e => {
      state.chatSearchTerm = e.target.value;
      renderChatList();
    });

    // Filtros de conversa
    $('chat-filter-unread').addEventListener('click', () => {
      state.chatFilter.unread = !state.chatFilter.unread;
      renderChatList();
    });
    $('chat-filter-vendor').addEventListener('change', e => {
      state.chatFilter.vendor = e.target.value;
      renderChatList();
    });

    // Painel do negócio (chat-info)
    $('ci-status').addEventListener('change', () => {
      if (state.chatInfoLeadId) updateLead(state.chatInfoLeadId, { pipeline_status: $('ci-status').value });
    });
    $('ci-vendor').addEventListener('change', () => {
      if (state.chatInfoLeadId) updateLead(state.chatInfoLeadId, { assigned_to: $('ci-vendor').value || null });
    });
    $('ci-valor').addEventListener('change', () => {
      if (!state.chatInfoLeadId) return;
      const v = $('ci-valor').value;
      updateLead(state.chatInfoLeadId, { valor: v === '' ? null : Number(v) });
    });
    let ciNotesT;
    $('ci-notes').addEventListener('input', () => {
      clearTimeout(ciNotesT);
      ciNotesT = setTimeout(() => {
        if (state.chatInfoLeadId) updateLead(state.chatInfoLeadId, { observacoes: $('ci-notes').value });
      }, 800);
    });
    $('ci-schedule').addEventListener('click', () => {
      if (state.chatInfoLead) openBookingLink(state.chatInfoLead);
    });
    $('ci-automate').addEventListener('click', () => {
      if (state.chatInfoLeadId) openSchedMsgModal(state.chatInfoLeadId);
    });
    $('ci-task').addEventListener('click', () => {
      const nome = state.chatInfoLead ? (state.chatInfoLead.nome || '') : '';
      openTaskModal(null, nome ? 'Follow-up: ' + nome : '');
    });
    $('ci-fulllead').addEventListener('click', () => {
      if (state.chatInfoLeadId) openLeadModal(state.chatInfoLeadId);
    });

    // Input auto-resize + send on Enter
    const input = $('chat-composer-input');
    const sendBtn = $('chat-send-btn');

    function updateSendBtnState() {
      sendBtn.disabled = !input.value.trim();
    }
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      updateSendBtnState();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (input.value.trim()) sendChatMessage(input.value.trim(), 'text');
      }
    });
    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) sendChatMessage(input.value.trim(), 'text');
    });

    // Template button
    $('chat-template-btn').addEventListener('click', () => {
      const conv = state.conversations.find(c => c.id === state.activeConversationId);
      if (!conv) return;
      const lead = conv.leads || {};
      const fname = firstName(lead.nome || '');
      const ok = confirm(`Enviar template "iniciar_conversa" pra ${fname || 'este lead'}?\n\nIsso reabre a janela de 24h pra conversa livre.`);
      if (!ok) return;
      sendChatMessage(
        `Template iniciar_conversa enviado para ${fname || 'lead'}`,
        'template',
        'iniciar_conversa',
        [fname || 'lead']
      );
    });

    // Ver lead
    $('chat-view-lead').addEventListener('click', () => {
      const conv = state.conversations.find(c => c.id === state.activeConversationId);
      if (!conv) return;
      openLeadModal(conv.lead_id);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL: Detalhes do lead
  // ═══════════════════════════════════════════════════════════════════
  function openLeadModal(id) {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return;
    state.currentLead = lead;

    const handle = lead.instagram || '';
    $('modal-name').textContent = lead.nome || '—';
    $('modal-handle').textContent = handle;
    $('modal-faturamento').textContent = lead.faturamento || '—';
    $('modal-momento').textContent = lead.momento || '—';
    $('modal-nota').textContent = lead.nota_geral != null
      ? Number(lead.nota_geral).toFixed(2).replace('.', ',') + ' / 5' : '—';
    $('modal-telefone').textContent = lead.telefone || '—';
    $('modal-data').textContent = formatDate(lead.created_at);

    // Origem do lead (campos do tracking)
    const origemEl = $('modal-origem');
    if (origemEl) {
      if (lead.source_type) {
        const sm = sourceMeta(lead.source_type);
        const parts = [`${sm.icon} ${sm.label}`];
        if (lead.source_campaign) parts.push(`Campanha: <strong>${escapeHtml(lead.source_campaign)}</strong>`);
        if (lead.source_creative) parts.push(`Criativo: <strong>${escapeHtml(lead.source_creative)}</strong>`);
        if (lead.source_medium)   parts.push(`Mídia: ${escapeHtml(lead.source_medium)}`);
        origemEl.innerHTML = parts.join(' · ');
      } else if (lead.origem) {
        origemEl.textContent = lead.origem;
      } else {
        origemEl.textContent = '—';
      }
    }

    // Lead Score
    const tempEl = $('modal-temp');
    if (tempEl) tempEl.innerHTML = scoreGauge(lead);

    // Avatar — foto do Instagram, com fallback no avatar local
    const av = $('modal-avatar-img');
    av.style.display = '';
    av.onerror = () => { av.onerror = null; av.src = localAvatar(lead.nome); };
    av.src = avatarUrl(handle, lead.nome);

    // Resumo do lead — gerado a partir dos dados do diagnóstico
    const sumEl = $('modal-summary');
    sumEl.textContent = lead.instagram_summary || buildLeadSummary(lead);
    sumEl.classList.remove('loading');

    // Top 3
    const tops = topsToList(lead);
    $('modal-top-list').innerHTML = tops.length
      ? tops.map((t, i) => `<div class="top-item"><span class="top-rank">0${i + 1}</span><span>${escapeHtml(t)}</span></div>`).join('')
      : '<div style="color:var(--text-faded);font-size:12px">Sem pontos críticos identificados</div>';

    // Notes
    $('modal-notes').value = lead.resumo_manual || '';

    // Status picker (usa pipeline dinâmico)
    $('status-picker').innerHTML = state.pipeline.map(s => `
      <button class="status-pick ${s.id === lead.pipeline_status ? 'active' : ''}"
              style="--col-color:${s.color}" data-status="${s.id}">
        <span class="status-pick-dot"></span>${escapeHtml(s.label)}
      </button>
    `).join('');
    $('status-picker').querySelectorAll('.status-pick').forEach(b => {
      b.addEventListener('click', async () => {
        const ns = b.dataset.status;
        if (ns === state.currentLead.pipeline_status) return;
        await updateLead(state.currentLead.id, { pipeline_status: ns });
        state.currentLead.pipeline_status = ns;
        $('status-picker').querySelectorAll('.status-pick').forEach(o => o.classList.remove('active'));
        b.classList.add('active');
      });
    });

    // Assigned to
    const assignSel = $('modal-assigned');
    assignSel.innerHTML = `<option value="">Não atribuído</option>` +
      state.profiles.map(p => `<option value="${p.id}" ${p.id === lead.assigned_to ? 'selected' : ''}>${escapeHtml(p.nome || p.email)}</option>`).join('');
    assignSel.onchange = () => updateLead(lead.id, { assigned_to: assignSel.value || null });

    // Links
    const fname = firstName(lead.nome);
    $('modal-wa').href = whatsappLink(lead.telefone, fname);
    $('modal-ig').href = instagramLink(handle);
    $('modal-delete').style.display = isAdmin() ? '' : 'none';

    $('modal-backdrop').classList.add('show');
  }

  // ─── Link de agendamento (lead/cliente marca a própria reunião) ───
  function openBookingLink(lead) {
    const vendedor = (lead && lead.assigned_to) || state.user.id;
    const url = location.origin + '/agendar.html?v=' + vendedor + (lead ? '&lead=' + lead.id : '');
    $('booklink-url').value = url;
    $('booklink-open').href = url;
    $('booklink-modal-backdrop').classList.add('show');
  }

  // ─── Relatório do lead (dentro do CRM) ───
  // Análise do lead — gerada a partir dos dados do diagnóstico (vários parágrafos)
  function buildLeadAnalysis(lead) {
    const inf = scoreInfo(lead);
    const nome = firstName(lead.nome) || 'O lead';
    const tops = topsToList(lead);
    const paras = [];
    paras.push(`Com lead score de <strong>${inf.score}/100</strong>, ${escapeHtml(nome)} é classificado como <strong>${inf.label}</strong>. ` +
      (inf.score >= 65 ? 'É um lead de boa qualidade — vale priorizar o contato e preparar uma abordagem consultiva.'
        : inf.score >= 45 ? 'É um lead intermediário — exige nutrição e uma boa condução antes de oferecer.'
          : 'É um lead de baixa prioridade neste momento — invista menos energia até ele amadurecer.'));
    if (lead.faturamento) {
      const low = /Até R\$ 5/.test(lead.faturamento), high = /Acima/.test(lead.faturamento);
      paras.push(`Faturamento declarado: <strong>${escapeHtml(lead.faturamento)}</strong>. ` +
        (low ? 'Orçamento mais restrito — ancore muito bem o valor e foque no retorno (ROI).'
          : high ? 'Tem bom poder de investimento — explore um pacote mais completo.'
            : 'Está na faixa ideal de investimento para a oferta.'));
    }
    if (lead.momento || lead.nota_geral != null) {
      let t = `Momento do diagnóstico: <strong>${escapeHtml(lead.momento || '—')}</strong>`;
      if (lead.nota_geral != null) {
        const n = Number(lead.nota_geral);
        t += `, com nota geral ${n.toFixed(2).replace('.', ',')}/5` +
          (n < 3.5 ? ' — há clareza da dor, momento favorável para abordar.'
            : ' — perfil mais maduro; ajuste o discurso para um nível mais avançado.');
      }
      paras.push(t + '.');
    }
    if (tops.length) {
      paras.push('Os pontos mais críticos apontados foram: <strong>' +
        tops.map(escapeHtml).join('</strong>, <strong>') + '</strong>. ' +
        'Conduza a conversa de diagnóstico por essas dores — são as portas de entrada da venda.');
    }
    paras.push('<strong>Próximo passo sugerido:</strong> ' +
      (inf.score >= 65 ? 'agendar uma call de diagnóstico o quanto antes e preparar uma proposta personalizada.'
        : inf.score >= 45 ? 'nutrir o lead com conteúdo de valor e fazer um follow-up consultivo antes de oferecer.'
          : 'manter no radar com follow-ups leves; repriorizar se o cenário do lead mudar.'));
    return paras;
  }

  // Respostas detalhadas do diagnóstico (q1a..q4c) — só se houver dados
  function reportDiagnostic(lead) {
    const blocks = [['q1a', 'q1b', 'q1c'], ['q2a', 'q2b', 'q2c'], ['q3a', 'q3b', 'q3c'], ['q4a', 'q4b', 'q4c']];
    const hasAny = blocks.some(b => b.some(k => lead[k] != null));
    if (!hasAny) return '';
    const rows = blocks.map((b, bi) => b.map((k, qi) => {
      const v = lead[k];
      return `<div class="report-q">
        <span class="report-q-lb">Bloco ${bi + 1}.${qi + 1}</span>
        <span class="report-q-bar"><span style="width:${v != null ? (v / 5 * 100) : 0}%"></span></span>
        <span class="report-q-val">${v != null ? v + '/5' : '—'}</span>
      </div>`;
    }).join('')).join('');
    return `<div class="report-section">
      <h4>Respostas do diagnóstico</h4>
      <div class="report-qgrid">${rows}</div>
    </div>`;
  }

  // Relatório 360° — visão completa do lead
  async function openReportModal(lead) {
    if (!lead) return;
    $('report-modal-backdrop').classList.add('show');
    $('report-body').innerHTML = '<div class="report-doc"><div class="empty-state"><div class="empty-state-text">Carregando relatório…</div></div></div>';
    if (state.leadHistory[lead.id] === undefined) {
      try { await loadLeadHistory(lead.id); } catch (_) { state.leadHistory[lead.id] = []; }
    }
    const history = state.leadHistory[lead.id] || [];
    const tops = topsToList(lead);
    const nota = lead.nota_geral != null
      ? Number(lead.nota_geral).toFixed(2).replace('.', ',') : '—';
    const origem = lead.source_type
      ? (sourceMeta(lead.source_type).icon + ' ' + sourceMeta(lead.source_type).label)
      : (lead.origem || '—');
    const stage = findStage(lead.pipeline_status);
    const vendedor = lead.assigned_to ? profileById(lead.assigned_to) : null;
    const sig = leadSignals(lead);
    const inf = scoreInfo(lead);
    const appts = (state.appointments || []).filter(a => a.lead_id === lead.id)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const fus = (state.tasks || []).filter(t => t.lead_id === lead.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const tags = Array.isArray(lead.tags) ? lead.tags : [];

    $('report-modal-sub').textContent =
      (lead.nome || 'Lead') + (lead.instagram ? ' · ' + lead.instagram : '');

    const comm = [
      ['Valor do negócio', lead.valor != null ? brl(lead.valor) : null],
      ['Prioridade', lead.prioridade],
      ['Empresa', lead.empresa],
      ['Cargo', lead.cargo],
      ['Cidade', lead.cidade],
      ['E-mail', lead.email],
      ['Produto de interesse', lead.produto],
      ['Interesse declarado', lead.interesse]
    ].filter(r => r[1]);

    const daysSince = sig.lastTouch ? Math.floor((Date.now() - sig.lastTouch) / 86400000) : null;
    const behavior = [
      ['Conversas iniciadas', sig.threads],
      ['Respondeu ao contato', sig.replied ? 'Sim' : 'Ainda não'],
      ['Reuniões agendadas', sig.appts],
      ['Follow-ups registrados', sig.followups],
      ['Última interação', daysSince == null ? '—' : daysSince === 0 ? 'Hoje' : daysSince + ' dia(s) atrás']
    ];

    const events = [];
    events.push({ t: new Date(lead.created_at).getTime(), ic: '🌱',
      txt: 'Lead criado' + (lead.source_type ? ' via ' + escapeHtml(sourceMeta(lead.source_type).label) : '') });
    history.forEach(h => events.push({ t: new Date(h.alterado_em).getTime(), ic: '🔄',
      txt: 'Movido para <strong>' + escapeHtml(findStage(h.status_novo).label) + '</strong>' }));
    appts.forEach(a => events.push({ t: new Date(a.starts_at).getTime(), ic: '📅',
      txt: 'Reunião: <strong>' + escapeHtml(a.title) + '</strong>' }));
    fus.forEach(t => events.push({ t: new Date(t.created_at).getTime(), ic: t.done ? '☑️' : '📋',
      txt: (t.done ? 'Follow-up concluído: ' : 'Follow-up criado: ') + '<strong>' + escapeHtml(t.title) + '</strong>' }));
    events.sort((a, b) => b.t - a.t);

    const sec = (title, body) => `<div class="report-section"><h4>${title}</h4>${body}</div>`;
    const kvGrid = rows => `<div class="report-kv">${rows.map(r =>
      `<div class="report-kv-row"><span>${escapeHtml(r[0])}</span><strong>${escapeHtml(String(r[1]))}</strong></div>`).join('')}</div>`;
    const isLost = lead.pipeline_status === 'perdida';

    $('report-body').innerHTML = `
      <div class="report-doc">
        <div class="report-hd">
          <div class="report-avatar"><img src="${avatarUrl(lead.instagram, lead.nome)}" alt="" onerror="${avatarFallback(lead.nome)}"></div>
          <div class="report-hd-info">
            <h3>${escapeHtml(lead.nome || '—')}</h3>
            <div class="report-hd-meta">${escapeHtml(lead.instagram || '')}${lead.telefone ? ' · ' + escapeHtml(lead.telefone) : ''}${lead.email ? ' · ' + escapeHtml(lead.email) : ''}</div>
            <div class="report-hd-meta">Diagnóstico em ${formatDate(lead.created_at)}</div>
          </div>
          <div class="report-hd-score" style="--sc:${inf.color}">
            <div class="report-hd-score-num">${inf.score}</div>
            <div class="report-hd-score-lb">${inf.label}</div>
          </div>
        </div>

        <div class="report-stats">
          <div class="report-stat"><span>Etapa atual</span><strong>${escapeHtml(stage.label)}</strong></div>
          <div class="report-stat"><span>Faturamento</span><strong>${escapeHtml(lead.faturamento || '—')}</strong></div>
          <div class="report-stat"><span>Momento</span><strong>${escapeHtml(lead.momento || '—')}</strong></div>
          <div class="report-stat"><span>Nota geral</span><strong>${nota} / 5</strong></div>
          <div class="report-stat"><span>Vendedor</span><strong>${vendedor ? escapeHtml(profileName(vendedor)) : '—'}</strong></div>
        </div>

        ${tags.length ? sec('Tags', '<div class="report-tags">' + tags.map(t =>
          `<span class="report-tag">${escapeHtml(t)}</span>`).join('') + '</div>') : ''}

        ${sec('Lead Score detalhado', scoreGauge(lead))}
        ${sec('Análise comercial do lead', buildLeadAnalysis(lead).map(p => `<p>${p}</p>`).join(''))}
        ${sec('Perfil comportamental', kvGrid(behavior))}
        ${comm.length ? sec('Informações comerciais', kvGrid(comm)) : ''}

        ${sec('Objetivos, dores e pontos críticos', tops.length
          ? '<div class="report-tops">' + tops.map((t, i) =>
              `<div class="report-top"><span>0${i + 1}</span>${escapeHtml(t)}</div>`).join('') + '</div>'
          : '<p style="color:var(--text-faded)">Sem pontos críticos identificados no diagnóstico.</p>')}

        ${reportDiagnostic(lead)}

        ${sec('Histórico da pipeline', history.length
          ? '<div class="report-timeline">' + history.map(h =>
              `<div class="report-tl-item"><span class="report-tl-ic">🔄</span><div><div class="report-tl-txt">Movido para <strong>${escapeHtml(findStage(h.status_novo).label)}</strong></div><div class="report-tl-meta">${formatDate(h.alterado_em)}${h.alterado_por_email ? ' · ' + escapeHtml(h.alterado_por_email) : ''}</div></div></div>`).join('') + '</div>'
          : '<p style="color:var(--text-faded)">Sem movimentações registradas ainda.</p>')}

        ${sec('Reuniões e calls', appts.length
          ? '<div class="report-list">' + appts.map(a =>
              `<div class="report-li"><span>📅</span><div><strong>${escapeHtml(a.title)}</strong><div class="report-tl-meta">${formatDate(a.starts_at)}${a.location ? ' · ' + escapeHtml(a.location) : ''}</div></div></div>`).join('') + '</div>'
          : '<p style="color:var(--text-faded)">Nenhuma reunião agendada com este lead.</p>')}

        ${sec('Follow-ups e tarefas', fus.length
          ? '<div class="report-list">' + fus.map(t =>
              `<div class="report-li"><span>${t.done ? '☑️' : '📋'}</span><div><strong>${escapeHtml(t.title)}</strong><div class="report-tl-meta">${t.done ? 'Concluída' : 'Pendente'}${t.due_date ? ' · vence ' + formatTaskDate(t.due_date) : ''}</div></div></div>`).join('') + '</div>'
          : '<p style="color:var(--text-faded)">Nenhum follow-up registrado.</p>')}

        ${sec('Timeline completa', events.length
          ? '<div class="report-timeline">' + events.map(e =>
              `<div class="report-tl-item"><span class="report-tl-ic">${e.ic}</span><div><div class="report-tl-txt">${e.txt}</div><div class="report-tl-meta">${formatDate(new Date(e.t).toISOString())}</div></div></div>`).join('') + '</div>'
          : '<p style="color:var(--text-faded)">Sem eventos.</p>')}

        ${(lead.resumo_manual || lead.observacoes) ? sec('Anotações do vendedor',
          (lead.resumo_manual ? `<p>${escapeHtml(lead.resumo_manual)}</p>` : '') +
          (lead.observacoes ? `<p>${escapeHtml(lead.observacoes)}</p>` : '')) : ''}

        ${isLost ? sec('Motivo da perda',
          `<p>${escapeHtml(lead.observacoes || lead.resumo_manual || 'Motivo não registrado — preencha nas observações do lead.')}</p>`) : ''}

        ${sec('Origem do lead', `<p>${escapeHtml(origem)}${lead.source_campaign ? ' · Campanha: ' + escapeHtml(lead.source_campaign) : ''}${lead.source_creative ? ' · Criativo: ' + escapeHtml(lead.source_creative) : ''}</p>`)}
      </div>`;
  }

  function closeAllModals() {
    $('modal-backdrop').classList.remove('show');
    $('report-modal-backdrop').classList.remove('show');
    $('booklink-modal-backdrop').classList.remove('show');
    $('edit-modal-backdrop').classList.remove('show');
    $('vendor-modal-backdrop').classList.remove('show');
    $('source-modal-backdrop').classList.remove('show');
    $('task-modal-backdrop').classList.remove('show');
    $('appt-modal-backdrop').classList.remove('show');
    $('schedmsg-modal-backdrop').classList.remove('show');
    $('proposta-modal-backdrop').classList.remove('show');
    const cm = $('contact-modal-backdrop');
    if (cm) cm.classList.remove('show');
    const ab = $('auto-builder-backdrop');
    if (ab) ab.classList.remove('show');
    const chm = $('channel-modal-backdrop');
    if (chm) chm.classList.remove('show');
    state.editingProposal = null;
    state.currentLead = null;
    state.editingLead = null;
    state.editingTask = null;
    state.editingAppointment = null;
    state.editingContact = null;
  }

  // Auto-save de notas
  let notesDebounce = null;
  $('modal-notes').addEventListener('input', () => {
    if (!state.currentLead) return;
    clearTimeout(notesDebounce);
    notesDebounce = setTimeout(async () => {
      const ok = await updateLead(state.currentLead.id, { resumo_manual: $('modal-notes').value });
      if (ok) toast('Anotações salvas', 'success');
    }, 800);
  });

  // ═══════════════════════════════════════════════════════════════════
  // MODAL: Editar lead
  // ═══════════════════════════════════════════════════════════════════
  function openEditModal(id) {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return;
    state.editingLead = lead;
    $('edit-nome').value = lead.nome || '';
    $('edit-telefone').value = lead.telefone || '';
    $('edit-instagram').value = (lead.instagram || '').replace(/^@/, '');
    $('edit-faturamento').value = lead.faturamento || '';
    $('edit-modal-backdrop').classList.add('show');
  }

  async function saveEdit() {
    if (!state.editingLead) return;
    const patch = {
      nome: $('edit-nome').value.trim(),
      telefone: $('edit-telefone').value.trim(),
      instagram: '@' + $('edit-instagram').value.trim().replace(/^@/, ''),
      faturamento: $('edit-faturamento').value || null
    };
    const ok = await updateLead(state.editingLead.id, patch);
    if (ok) {
      toast('Lead atualizado', 'success');
      $('edit-modal-backdrop').classList.remove('show');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL: Contato manual (criar / editar lead completo)
  // ═══════════════════════════════════════════════════════════════════
  function openContactModal(id) {
    const lead = id ? state.leads.find(l => l.id === id) : null;
    state.editingContact = lead || null;
    state.contactProfileText = lead ? (lead.resumo_manual || '') : '';
    $('contact-modal-title').textContent = lead ? 'Editar contato' : 'Novo contato';
    $('ct-nome').value = lead ? (lead.nome || '') : '';
    $('ct-telefone').value = lead ? (lead.telefone || '') : '';
    $('ct-email').value = lead ? (lead.email || '') : '';
    $('ct-instagram').value = lead ? (lead.instagram || '') : '';
    $('ct-empresa').value = lead ? (lead.empresa || '') : '';
    $('ct-cargo').value = lead ? (lead.cargo || '') : '';
    $('ct-cidade').value = lead ? (lead.cidade || '') : '';
    $('ct-origem').value = lead ? (lead.source_type || 'whatsapp') : 'whatsapp';
    $('ct-status').innerHTML = state.pipeline.map(s =>
      `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
    $('ct-status').value = lead ? lead.pipeline_status : ((state.pipeline[0] || {}).id || '');
    $('ct-assigned').innerHTML = '<option value="">Não atribuído</option>' +
      state.profiles.map(p => `<option value="${p.id}">${escapeHtml(profileName(p))}</option>`).join('');
    $('ct-assigned').value = lead ? (lead.assigned_to || '') : state.user.id;
    $('ct-prioridade').value = lead ? (lead.prioridade || 'Média') : 'Média';
    $('ct-faturamento').value = lead ? (lead.faturamento || '') : '';
    $('ct-valor').value = lead && lead.valor != null ? lead.valor : '';
    $('ct-produto').value = lead ? (lead.produto || '') : '';
    $('ct-interesse').value = lead ? (lead.interesse || '') : '';
    $('ct-tags').value = lead && Array.isArray(lead.tags) ? lead.tags.join(', ') : '';
    $('ct-observacoes').value = lead ? (lead.observacoes || '') : '';
    $('ct-ai-content').innerHTML = state.contactProfileText
      ? formatContactProfile(state.contactProfileText)
      : 'Preencha os dados e clique em <strong>"Gerar análise"</strong> — o sistema monta automaticamente o resumo, o perfil do cliente, a intenção, o potencial de compra, possíveis objeções e a recomendação comercial.';
    $('ct-delete').style.display = lead && isAdmin() ? '' : 'none';
    $('contact-modal-backdrop').classList.add('show');
    setTimeout(() => $('ct-nome').focus(), 60);
  }

  function readContactForm() {
    const tags = $('ct-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    let ig = $('ct-instagram').value.trim();
    if (ig && !ig.startsWith('@')) ig = '@' + ig;
    const numOrNull = v => (v !== '' && v != null && !isNaN(v)) ? Number(v) : null;
    return {
      nome: $('ct-nome').value.trim(),
      telefone: $('ct-telefone').value.trim() || null,
      email: $('ct-email').value.trim() || null,
      instagram: ig || null,
      empresa: $('ct-empresa').value.trim() || null,
      cargo: $('ct-cargo').value.trim() || null,
      cidade: $('ct-cidade').value.trim() || null,
      source_type: $('ct-origem').value || 'outro',
      pipeline_status: $('ct-status').value,
      assigned_to: $('ct-assigned').value || null,
      prioridade: $('ct-prioridade').value || null,
      faturamento: $('ct-faturamento').value || null,
      valor: numOrNull($('ct-valor').value),
      produto: $('ct-produto').value.trim() || null,
      interesse: $('ct-interesse').value.trim() || null,
      tags,
      observacoes: $('ct-observacoes').value.trim() || null
    };
  }

  // Gera análise comercial heurística (sem IA) a partir dos dados do contato
  function buildContactProfile(d) {
    const fname = firstName(d.nome) || 'O contato';
    const organica = ['indicacao', 'instagram_organico', 'facebook_organico', 'direct'].includes(d.source_type);
    const highBudget = /Acima|R\$ 30|R\$ 15/.test(d.faturamento || '');
    const prio = (d.prioridade || '').toLowerCase();
    let resumo = `${fname} é um contato de origem "${sourceMeta(d.source_type).label}"`;
    if (d.empresa) resumo += `, da empresa ${d.empresa}`;
    if (d.cargo) resumo += ` (${d.cargo})`;
    resumo += '.';
    if (d.faturamento) resumo += ` Faturamento declarado: ${d.faturamento}.`;
    if (d.cidade) resumo += ` Localizado em ${d.cidade}.`;
    const lines = [
      ['Resumo', resumo],
      ['Perfil do cliente', organica
        ? 'Lead de canal orgânico/indicação — tende a chegar mais aquecido e com maior confiança na marca.'
        : d.source_type === 'trafego_pago'
          ? 'Lead de tráfego pago — ainda frio: precisa de aquecimento e construção de autoridade antes da oferta.'
          : 'Lead de canal direto — avalie o nível de consciência e a urgência antes de avançar.'],
      ['Intenção', d.interesse
        ? `Demonstrou interesse em: ${d.interesse}.`
        : (d.produto ? `Interesse no produto/serviço: ${d.produto}.` : 'Intenção ainda não detalhada — qualifique na primeira conversa.')],
      ['Potencial de compra', (highBudget || prio === 'alta')
        ? 'Alto — bom poder de investimento e/ou prioridade alta. Vale acelerar a abordagem.'
        : prio === 'baixa'
          ? 'Baixo no momento — mantenha em nutrição e reavalie em alguns dias.'
          : 'Médio — qualifique melhor o orçamento e a urgência antes de propor.'],
      ['Possíveis objeções', (d.faturamento && /Até R\$ 5/.test(d.faturamento))
        ? 'Preço/orçamento — ancore o valor no retorno (ROI) e ofereça uma porta de entrada acessível.'
        : !d.interesse
          ? 'Falta de clareza da necessidade — conduza um diagnóstico antes de oferecer.'
          : 'Tempo e confiança — reforce provas sociais e cases do nicho de estética/clínicas.'],
      ['Recomendação comercial', (highBudget || prio === 'alta')
        ? 'Agende uma call de diagnóstico o quanto antes e prepare uma proposta personalizada.'
        : 'Faça um follow-up consultivo, envie conteúdo de valor e qualifique o orçamento antes da proposta.']
    ];
    return lines.map(([t, b]) => `### ${t}\n${b}`).join('\n\n');
  }
  function formatContactProfile(raw) {
    return String(raw || '').split('\n\n').map(block => {
      const m = block.match(/^### (.+)\n([\s\S]*)$/);
      if (m) return `<div class="ct-ai-sec"><b>${escapeHtml(m[1])}</b><span>${escapeHtml(m[2])}</span></div>`;
      return `<p>${escapeHtml(block)}</p>`;
    }).join('');
  }

  async function saveContact() {
    const form = readContactForm();
    if (!form.nome) { toast('Informe o nome do contato', 'error'); return; }
    const editing = state.editingContact;
    const btn = $('ct-save');
    btn.disabled = true;
    let error;
    if (editing) {
      ({ error } = await supabase.from('leads')
        .update({ ...form, atualizado_por: state.user.id }).eq('id', editing.id));
    } else {
      form.origem = 'Cadastro manual';
      form.resumo_manual = state.contactProfileText || buildContactProfile(form);
      form.project_id = state.projectId;
      ({ error } = await supabase.from('leads').insert(form));
    }
    btn.disabled = false;
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    await loadLeads();
    closeAllModals();
    renderAll();
    toast(editing ? 'Contato atualizado' : 'Contato cadastrado', 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // MODAL: Novo vendedor
  // ═══════════════════════════════════════════════════════════════════
  function openVendorModal() {
    $('vendor-name').value = '';
    $('vendor-email').value = '';
    $('vendor-phone').value = '';
    $('vendor-password').value = generatePassword();
    $('vendor-role').value = 'vendedor';
    // Reset permissões pro default (vendedor)
    const defaults = defaultPerms('vendedor');
    $$('#vendor-perms input[type="checkbox"]').forEach(cb => {
      cb.checked = !!defaults[cb.dataset.perm];
    });
    $('vendor-modal-backdrop').classList.add('show');
  }

  function generatePassword() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars.charAt(Math.floor(Math.random() * chars.length));
    return p;
  }

  async function saveVendor() {
    const name = $('vendor-name').value.trim();
    const email = $('vendor-email').value.trim().toLowerCase();
    const phone = $('vendor-phone').value.trim();
    const password = $('vendor-password').value;
    const role = $('vendor-role').value;

    // Lê permissões dos checkboxes
    const permissions = {};
    $$('#vendor-perms input[type="checkbox"]').forEach(cb => {
      permissions[cb.dataset.perm] = cb.checked;
    });

    if (!name || !email || !password) { toast('Preencha nome, email e senha', 'error'); return; }
    if (password.length < 6) { toast('Senha precisa de no mínimo 6 caracteres', 'error'); return; }

    // Cria o usuário via Edge Function (server-side, com service_role).
    // NÃO usa supabase.auth.signUp no cliente: isso trocaria a sessão do admin
    // pela do novo usuário e dependia da falha de escalação de privilégio para
    // definir o `role`. A função create-vendor faz tudo no servidor.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/create-vendor', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, email, password, phone, role, permissions })
      });
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || ('HTTP ' + res.status));
    } catch (err) {
      toast('Erro: ' + err.message, 'error');
      return;
    }

    await loadProfiles();
    renderVendors();
    $('vendor-modal-backdrop').classList.remove('show');
    toast(`${name} cadastrado. Avise por WhatsApp/Email: senha ${password}`, 'success');
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT BINDINGS
  // ═══════════════════════════════════════════════════════════════════
  function bindEvents() {
    // Login
    $('login-form').addEventListener('submit', e => {
      e.preventDefault();
      login($('login-email').value.trim(), $('login-password').value);
    });
    // Menu de usuário (topbar)
    const userWrap = document.querySelector('.topbar-user-wrap');
    $('topbar-user').addEventListener('click', (e) => {
      e.stopPropagation();
      userWrap.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topbar-user-wrap')) userWrap.classList.remove('open');
    });
    document.querySelectorAll('.user-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        userWrap.classList.remove('open');
        const action = item.dataset.action;
        if (action === 'logout') logout();
        if (action === 'profile') switchView('settings');
      });
    });

    // Seletor de projeto (sidebar)
    const projSwitch = $('project-switch');
    if (projSwitch) {
      $('project-switch-btn').addEventListener('click', e => {
        e.stopPropagation();
        projSwitch.classList.toggle('open');
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('#project-switch')) projSwitch.classList.remove('open');
      });
    }

    // Navegação
    $$('.nav-item').forEach(b => {
      b.addEventListener('click', () => switchView(b.dataset.view));
    });
    // Voltar/avançar do navegador respeita a view no hash
    window.addEventListener('hashchange', () => {
      const hv = (location.hash || '').replace('#', '');
      if (hv && hv !== state.currentView) {
        const btn = document.querySelector('.nav-item[data-view="' + hv + '"]');
        if (btn && btn.style.display !== 'none') switchView(hv);
      }
    });

    // Notificações
    $('topbar-bell').addEventListener('click', e => {
      e.stopPropagation();
      $('notif-panel').classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.topbar-bell-wrap')) $('notif-panel').classList.remove('open');
    });
    $('notif-readall').addEventListener('click', markAllNotifsRead);
    $('notif-list').addEventListener('click', e => {
      const item = e.target.closest('[data-notif]');
      if (!item) return;
      const n = state.notifications.find(x => x.id === item.dataset.notif);
      if (n && !n.read) {
        n.read = true;
        renderNotifications();
        supabase.from('notifications').update({ read: true }).eq('id', n.id);
      }
      if (item.dataset.lead) {
        $('notif-panel').classList.remove('open');
        openLeadModal(item.dataset.lead);
      }
    });
    $('topbar-tasks').addEventListener('click', () => switchView('tasks'));

    // Busca
    $('search-input').addEventListener('input', e => {
      state.searchTerm = e.target.value;
      renderAll();
    });

    // Filtros
    $('filter-vendor').addEventListener('change', e => { state.filters.vendor = e.target.value; renderAll(); });
    $('filter-revenue').addEventListener('change', e => { state.filters.revenue = e.target.value; renderAll(); });
    $('filter-period').addEventListener('change', e => { state.filters.period = e.target.value; renderAll(); });
    $('filter-clear').addEventListener('click', () => {
      state.filters = { vendor: '', revenue: '', period: '' };
      state.searchTerm = '';
      $('search-input').value = '';
      $('toolbar').querySelectorAll('.filter-select').forEach(s => s.value = '');
      renderAll();
    });

    // Filtros do Dashboard
    const dashF = id => { const el = $(id); if (el) el.addEventListener('change', e => {
      const key = id.replace('dash-', '');
      state.dashFilter[key] = e.target.value;
      renderMetrics();
    }); };
    dashF('dash-period'); dashF('dash-vendor'); dashF('dash-source');
    const dfc = $('dash-filter-clear');
    if (dfc) dfc.addEventListener('click', () => {
      state.dashFilter = { period: '', vendor: '', source: '' };
      renderMetrics();
    });

    // Modal lead
    $('modal-close').addEventListener('click', closeAllModals);
    $('modal-backdrop').addEventListener('click', e => { if (e.target === $('modal-backdrop')) closeAllModals(); });
    $('modal-delete').addEventListener('click', () => {
      if (state.currentLead) deleteLead(state.currentLead.id);
    });

    // Modal edit
    $('edit-modal-close').addEventListener('click', closeAllModals);
    $('edit-modal-backdrop').addEventListener('click', e => { if (e.target === $('edit-modal-backdrop')) closeAllModals(); });
    $('edit-cancel').addEventListener('click', closeAllModals);
    $('edit-save').addEventListener('click', saveEdit);

    // Modal de contato manual
    const btnNewContact = $('btn-new-contact');
    if (btnNewContact) btnNewContact.addEventListener('click', () => openContactModal(null));
    $('contact-modal-close').addEventListener('click', closeAllModals);
    $('ct-cancel').addEventListener('click', closeAllModals);
    $('contact-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('contact-modal-backdrop')) closeAllModals();
    });
    $('ct-save').addEventListener('click', saveContact);
    $('ct-delete').addEventListener('click', () => {
      if (state.editingContact) deleteLead(state.editingContact.id);
    });
    $('ct-generate').addEventListener('click', () => {
      const form = readContactForm();
      if (!form.nome) { toast('Informe ao menos o nome para gerar a análise', 'error'); return; }
      state.contactProfileText = buildContactProfile(form);
      $('ct-ai-content').innerHTML = formatContactProfile(state.contactProfileText);
    });

    // Modal vendor
    $('vendor-modal-close').addEventListener('click', closeAllModals);
    $('vendor-modal-backdrop').addEventListener('click', e => { if (e.target === $('vendor-modal-backdrop')) closeAllModals(); });
    $('vendor-cancel').addEventListener('click', closeAllModals);
    $('vendor-save').addEventListener('click', saveVendor);
    $('btn-add-vendor').addEventListener('click', openVendorModal);

    // Quando muda a função, recalcula defaults de permissão
    $('vendor-role').addEventListener('change', () => {
      const role = $('vendor-role').value;
      const defs = defaultPerms(role);
      $$('#vendor-perms input[type="checkbox"]').forEach(cb => {
        cb.checked = !!defs[cb.dataset.perm];
      });
    });

    // Source detail modal
    $('source-modal-close').addEventListener('click', closeAllModals);
    $('source-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('source-modal-backdrop')) closeAllModals();
    });
    $$('#source-modal-tabs .source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.style.display === 'none') return;
        sourceModalState.tab = tab.dataset.tab;
        $$('#source-modal-tabs .source-tab').forEach(t => t.classList.toggle('active', t === tab));
        const leads = state.leads.filter(l => (l.source_type || 'outro') === sourceModalState.key);
        renderSourceModalContent(leads);
      });
    });

    // Save profile
    $('btn-save-profile').addEventListener('click', saveProfile);

    // Upload de foto de perfil
    $('profile-avatar-btn').addEventListener('click', () => $('profile-avatar-input').click());
    $('profile-avatar-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleAvatarUpload(e.target.files[0]);
    });

    // Save WhatsApp config
    $('btn-save-whatsapp').addEventListener('click', saveWhatsAppConfig);

    // Submenu de Configurações
    $$('#settings-nav .settings-nav-item').forEach(btn => {
      btn.addEventListener('click', () => showSettingsSection(btn.dataset.section));
    });
    // Save Google config
    $('btn-save-google').addEventListener('click', saveGoogleConfig);

    // Captação de leads — canais
    $('btn-add-channel').addEventListener('click', openChannelModal);
    $('channel-modal-close').addEventListener('click', closeAllModals);
    $('channel-cancel').addEventListener('click', closeAllModals);
    $('channel-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('channel-modal-backdrop')) closeAllModals();
    });
    $('channel-save').addEventListener('click', saveChannel);
    $('capture-list').addEventListener('click', e => {
      const tg = e.target.closest('[data-ch-toggle]');
      if (tg) { toggleChannel(tg.dataset.chToggle); return; }
      const del = e.target.closest('[data-ch-del]');
      if (del) { deleteChannel(del.dataset.chDel); return; }
      const cp = e.target.closest('[data-ch-copy]');
      if (cp) {
        const c = state.captureChannels.find(x => x.id === cp.dataset.chCopy);
        if (c) {
          const payload = JSON.stringify({ channel: c.slug, lead: { nome: '', telefone: '', email: '' } }, null, 2);
          if (navigator.clipboard) navigator.clipboard.writeText(payload);
          toast('Payload de exemplo copiado', 'success');
        }
      }
    });

    // Chat events
    bindChatEvents();

    // Relatório do lead
    $('modal-report').addEventListener('click', () => {
      if (state.currentLead) openReportModal(state.currentLead);
    });
    // Link de agendamento
    $('modal-schedule').addEventListener('click', () => {
      if (state.currentLead) openBookingLink(state.currentLead);
    });
    $('booklink-close').addEventListener('click', closeAllModals);
    $('booklink-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('booklink-modal-backdrop')) closeAllModals();
    });
    $('booklink-copy').addEventListener('click', () => {
      const inp = $('booklink-url');
      inp.select();
      const done = () => toast('Link copiado!', 'success');
      if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(done).catch(() => { document.execCommand('copy'); done(); });
      else { document.execCommand('copy'); done(); }
    });
    $('report-modal-close').addEventListener('click', closeAllModals);
    $('report-close-btn').addEventListener('click', closeAllModals);
    $('report-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('report-modal-backdrop')) closeAllModals();
    });
    $('report-print').addEventListener('click', () => window.print());

    // Botão "Abrir chat interno" no modal de lead
    $('modal-chat').addEventListener('click', () => {
      if (state.currentLead) {
        const leadId = state.currentLead.id;
        closeAllModals();
        openChatForLead(leadId);
      }
    });

    // Pipeline editor
    $('pipeline-add').addEventListener('click', () => {
      if (state.pipeline.length >= 10) { toast('Máximo de 10 etapas', 'error'); return; }
      const colors = ['#A5B4FC', '#FDBA74', '#86EFAC', '#D4D4D8', '#FCD34D', '#34D399', '#FCA5A5', '#67E8F9', '#F0ABFC', '#FDA4AF'];
      const newColor = colors[state.pipeline.length % colors.length];
      const newStage = { id: 'stage_' + Date.now(), label: 'Nova etapa', color: newColor, order: state.pipeline.length };
      state.pipeline.push(newStage);
      renderPipelineEditor();
    });
    $('btn-save-pipeline').addEventListener('click', async () => {
      const newPipeline = readPipelineEditor();
      if (newPipeline.length < 3) { toast('Mínimo de 3 etapas', 'error'); return; }
      const btn = $('btn-save-pipeline');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando';
      await savePipeline(newPipeline);
      btn.disabled = false; btn.innerHTML = '<svg><use href="#i-check"/></svg> Salvar';
    });

    // Tarefas
    $('btn-add-task').addEventListener('click', () => openTaskModal(null));
    $('task-modal-close').addEventListener('click', closeAllModals);
    $('task-cancel').addEventListener('click', closeAllModals);
    $('task-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('task-modal-backdrop')) closeAllModals();
    });
    $('task-save').addEventListener('click', saveTask);
    $('task-delete').addEventListener('click', () => {
      if (state.editingTask) deleteTask(state.editingTask.id);
    });
    $('task-title').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
    });
    // Filtro de tarefas (Pendentes / Concluídas / Todas)
    $$('#tasks-filter .tasks-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.taskFilter = btn.dataset.tfilter;
        $$('#tasks-filter .tasks-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderTasks();
      });
    });
    // Delegação de cliques na lista de tarefas (linhas são re-renderizadas)
    $('tasks-list').addEventListener('click', e => {
      const subToggle = e.target.closest('[data-task-subs]');
      if (subToggle) {
        const id = subToggle.dataset.taskSubs;
        state.expandedTasks[id] = !state.expandedTasks[id];
        renderTasks();
        return;
      }
      const subChk = e.target.closest('[data-subtask-toggle]');
      if (subChk) {
        const [tid, idx] = subChk.dataset.subtaskToggle.split(':');
        toggleSubtaskDone(tid, Number(idx));
        return;
      }
      const toggle = e.target.closest('[data-task-toggle]');
      if (toggle) { toggleTaskDone(toggle.dataset.taskToggle); return; }
      const del = e.target.closest('[data-task-del]');
      if (del) { deleteTask(del.dataset.taskDel); return; }
      const leadChip = e.target.closest('[data-task-lead]');
      if (leadChip) { e.stopPropagation(); openLeadModal(leadChip.dataset.taskLead); return; }
      const open = e.target.closest('[data-task-open]');
      if (open) { openTaskModal(open.dataset.taskOpen); return; }
    });

    // Editor de subtarefas no modal de tarefa
    $('subtask-add').addEventListener('click', () => {
      syncSubtaskEditor();
      state.editingSubtasks.push({ id: subGenId(), title: '', done: false, assignee: null, due: null });
      renderSubtaskEditor();
      const rows = $$('#subtask-list .subtask-row');
      const last = rows[rows.length - 1];
      if (last) last.querySelector('.subtask-title').focus();
    });
    $('subtask-list').addEventListener('click', e => {
      const toggle = e.target.closest('[data-sub-toggle]');
      if (toggle) {
        syncSubtaskEditor();
        const s = state.editingSubtasks.find(x => x.id === toggle.dataset.subToggle);
        if (s) s.done = !s.done;
        renderSubtaskEditor();
        return;
      }
      const del = e.target.closest('[data-sub-del]');
      if (del) {
        syncSubtaskEditor();
        state.editingSubtasks = state.editingSubtasks.filter(x => x.id !== del.dataset.subDel);
        renderSubtaskEditor();
      }
    });

    // Agenda
    $('agenda-prev').addEventListener('click', () => agendaShift(-1));
    $('agenda-next').addEventListener('click', () => agendaShift(1));
    $$('#agenda-views .agenda-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.agendaView = btn.dataset.aview;
        renderAgenda();
      });
    });
    $('agenda-today').addEventListener('click', () => {
      const t = new Date();
      state.agendaMonth = new Date(t.getFullYear(), t.getMonth(), 1);
      state.agendaSelectedDay = ymd(t);
      renderAgenda();
    });
    $('btn-add-appt').addEventListener('click', () => openAppointmentModal(null));
    const btnAgSync = $('btn-agenda-sync');
    if (btnAgSync) btnAgSync.addEventListener('click', importGoogleEvents);
    const btnAgBook = $('btn-agenda-booklink');
    if (btnAgBook) btnAgBook.addEventListener('click', () => openBookingLink(null));
    // Presets de duração no modal de reunião
    const apptDur = $('appt-duration');
    if (apptDur) apptDur.addEventListener('click', e => {
      const b = e.target.closest('[data-dur]');
      if (!b) return;
      const start = $('appt-start').value;
      if (!start) { toast('Defina o horário de início primeiro', 'error'); return; }
      const [h, m] = start.split(':').map(Number);
      const end = new Date(2000, 0, 1, h, m + Number(b.dataset.dur));
      $('appt-end').value = pad2(end.getHours()) + ':' + pad2(end.getMinutes());
      apptDur.querySelectorAll('.appt-dur-btn').forEach(x => x.classList.toggle('active', x === b));
    });
    $('agenda-grid').addEventListener('click', e => {
      const chip = e.target.closest('[data-appt]');
      if (chip) { openAppointmentModal(chip.dataset.appt); return; }
      const day = e.target.closest('[data-day]');
      if (day) { state.agendaSelectedDay = day.dataset.day; renderAgenda(); }
    });
    $('agenda-day-list').addEventListener('click', e => {
      const row = e.target.closest('[data-appt]');
      if (row) openAppointmentModal(row.dataset.appt);
    });
    // Modal de reunião
    $('appt-modal-close').addEventListener('click', closeAllModals);
    $('appt-cancel').addEventListener('click', closeAllModals);
    $('appt-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('appt-modal-backdrop')) closeAllModals();
    });
    $('appt-save').addEventListener('click', saveAppointment);
    $('appt-delete').addEventListener('click', () => {
      if (state.editingAppointment) deleteAppointment(state.editingAppointment.id);
    });

    // Automações
    $('btn-save-reminders').addEventListener('click', saveReminders);
    $('btn-add-schedmsg').addEventListener('click', () => openSchedMsgModal());
    $('btn-new-automation').addEventListener('click', () => openAutomationBuilder('new'));
    $$('#auto2-tabs .auto2-tab').forEach(b =>
      b.addEventListener('click', () => showAuto2Tab(b.dataset.atab)));
    $('auto-table-body').addEventListener('click', e => {
      const ed = e.target.closest('[data-auto-edit]');
      if (ed) { openAutomationBuilder(ed.dataset.autoEdit); return; }
      const dp = e.target.closest('[data-auto-dup]');
      if (dp) { duplicateAutomation(dp.dataset.autoDup); return; }
      const dl = e.target.closest('[data-auto-del]');
      if (dl) { deleteAutomation(dl.dataset.autoDel); return; }
      const tg = e.target.closest('[data-auto-toggle]');
      if (tg) { toggleAutomation(tg.dataset.autoToggle); return; }
    });
    $('auto-builder-close').addEventListener('click', () => {
      $('auto-builder-backdrop').classList.remove('show');
    });
    $('auto-builder-backdrop').addEventListener('click', e => {
      if (e.target === $('auto-builder-backdrop')) $('auto-builder-backdrop').classList.remove('show');
    });

    // Propostas
    $('btn-new-proposal').addEventListener('click', () => openProposalModal(null));
    $('proposta-modal-close').addEventListener('click', closeAllModals);
    $('proposta-cancel').addEventListener('click', closeAllModals);
    $('proposta-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('proposta-modal-backdrop')) closeAllModals();
    });
    $('proposta-save').addEventListener('click', saveProposal);
    $('proposta-delete').addEventListener('click', () => {
      if (state.editingProposal) deleteProposal(state.editingProposal.id);
    });
    $('propostas-list').addEventListener('click', e => {
      const view = e.target.closest('[data-prop-view]');
      if (view) { window.open(proposalLink(view.dataset.propView), '_blank'); return; }
      const open = e.target.closest('[data-prop-open]');
      if (open) { openProposalModal(open.dataset.propOpen); return; }
      const del = e.target.closest('[data-prop-del]');
      if (del) { deleteProposal(del.dataset.propDel); return; }
      const link = e.target.closest('[data-prop-link]');
      if (link) {
        const url = proposalLink(link.dataset.propLink);
        const done = () => toast('Link da apresentação copiado!', 'success');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(done);
        else done();
      }
    });
    $('schedmsg-modal-close').addEventListener('click', closeAllModals);
    $('schedmsg-cancel').addEventListener('click', closeAllModals);
    $('schedmsg-modal-backdrop').addEventListener('click', e => {
      if (e.target === $('schedmsg-modal-backdrop')) closeAllModals();
    });
    $('schedmsg-save').addEventListener('click', saveSchedMsg);
    // Mídia na mensagem agendada
    const smSet = m => { state.schedMedia = m; renderSchedMediaPreview(); };
    $('sm-media-audio').addEventListener('click', () => {
      toggleAudioRecording(smSet, rec => $('sm-media-audio').classList.toggle('recording', rec));
    });
    $('sm-media-image').addEventListener('click', () => pickMediaFile('image/*', 'image', smSet));
    $('sm-media-file').addEventListener('click', () => pickMediaFile('*/*', 'file', smSet));
    $('sm-media-link').addEventListener('click', () => {
      const u = prompt('Cole o link a enviar:');
      if (u && u.trim()) smSet({ type: 'link', url: u.trim(), name: u.trim() });
    });
    $('schedmsg-list').addEventListener('click', e => {
      const del = e.target.closest('[data-schedmsg-del]');
      if (del) deleteSchedMsg(del.dataset.schedmsgDel);
    });

    // Playbook — troca de abas
    $('playbook-tabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-ptab]');
      if (!btn) return;
      state.playbookTab = btn.dataset.ptab;
      renderPlaybook();
      btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });

    // Construtor de fluxo: arrastar nós e criar conexões
    document.addEventListener('mousemove', e => {
      if (flowDrag) {
        const nx = Math.max(0, flowDrag.ox + (e.clientX - flowDrag.sx));
        const ny = Math.max(0, flowDrag.oy + (e.clientY - flowDrag.sy));
        flowDrag.el.style.left = nx + 'px';
        flowDrag.el.style.top = ny + 'px';
        flowDrawEdges();
      } else if (flowLink) {
        const canvas = $('flow-canvas');
        if (canvas) {
          const r = canvas.getBoundingClientRect();
          flowDrawEdges(e.clientX - r.left + canvas.scrollLeft, e.clientY - r.top + canvas.scrollTop);
        }
      }
    });
    document.addEventListener('mouseup', e => {
      if (flowDrag) {
        const n = state.flow.nodes.find(x => x.id === flowDrag.el.dataset.nodeId);
        if (n) { n.x = flowDrag.el.offsetLeft; n.y = flowDrag.el.offsetTop; }
        flowDrag = null;
      }
      if (flowLink) {
        const target = e.target.closest('.flow-node');
        if (target && target.dataset.nodeId !== flowLink.from && target.dataset.nodeType !== 'trigger') {
          const to = target.dataset.nodeId;
          if (!state.flow.edges.some(ed => ed.from === flowLink.from && ed.to === to)) {
            state.flow.edges.push({ from: flowLink.from, to });
          }
        }
        flowLink = null;
        flowDrawEdges();
      }
    });

    // ESC fecha modais
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllModals();
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════
  bindEvents();
  tryRestoreSession();

})();
