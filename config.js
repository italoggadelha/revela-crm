// ═══════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DO CRM v2
// ═══════════════════════════════════════════════════════════════════

window.CRM_CONFIG = {
  // Supabase self-hosted no VPS Hostinger (api.mylion.com.br)
  SUPABASE_URL: "https://api.mylion.com.br",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4OTgyMzI4LCJleHAiOjIwOTQzNDIzMjh9.dBffZxejYKo6Lnng5H5RE0ONLOwJHnFhuwpCTLpbDco",

  // URL do relatório individual (usado nos cards)
  REPORT_BASE_URL: "https://camilalouback.com/relatorio.html",

  // Email do admin (vê todos os leads + pode deletar + gerenciar equipe)
  ADMIN_EMAIL: "italoggadelha@gmail.com",

  // Endpoint da Edge Function que gera o resumo do lead (IG + IA)
  // O Supabase chama esta URL automaticamente via Functions
  SUMMARY_FUNCTION_PATH: "/functions/v1/generate-summary"
};
