/* ==========================================================================
   HAUREA DIGITAL — Inicialização do Supabase
   Colocar DEPOIS do script da biblioteca Supabase no HTML:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ========================================================================== */

(() => {
    "use strict";

    // ---------------------------------------------------------------------
    // Configuração (só chave pública — nunca a "secret" nem a "service_role").
    // A chave "publishable" é pública por desenho; a segurança vem do RLS.
    // ---------------------------------------------------------------------
    const SUPABASE_URL = "https://npwujzliadqfbsqqxzdw.supabase.co";
    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_zESfqnD6LaMWHI_c3kIytA_D5xMOnbV";

    const LOG_PREFIX = "HAUREA DIGITAL:";

    // ---------------------------------------------------------------------
    // Evitar inicializar duas vezes (caso o script seja carregado 2x)
    // ---------------------------------------------------------------------
    if (window.supabaseClient) {
        console.warn(`${LOG_PREFIX} Supabase já estava inicializado.`);
        return;
    }

    // ---------------------------------------------------------------------
    // Verificar se a biblioteca Supabase foi carregada
    // ---------------------------------------------------------------------
    const createClient = window.supabase?.createClient;

    if (typeof createClient !== "function") {
        console.error(
            `${LOG_PREFIX} a biblioteca Supabase não foi carregada. ` +
                "Confirme que o <script> da biblioteca vem antes deste ficheiro no HTML."
        );
        window.HAUREA_SUPABASE_READY = false;
        return;
    }

    // ---------------------------------------------------------------------
    // Validar a configuração
    // ---------------------------------------------------------------------
    const url = SUPABASE_URL.trim();
    const chave = SUPABASE_PUBLISHABLE_KEY.trim();

    const urlValido = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
    const chaveValida = chave.startsWith("sb_publishable_");

    if (!urlValido || !chaveValida) {
        console.error(
            `${LOG_PREFIX} configuração inválida. Verifique o URL e a chave pública do Supabase.`
        );
        window.HAUREA_SUPABASE_READY = false;
        return;
    }

    // ---------------------------------------------------------------------
    // Criar a ligação ao Supabase
    // ---------------------------------------------------------------------
    try {
        window.supabaseClient = createClient(url, chave, {
            auth: {
                persistSession: true,      // mantém a sessão iniciada
                autoRefreshToken: true,    // renova a sessão automaticamente
                detectSessionInUrl: true,  // necessário para o link de recuperação (reset.html)
            },
        });

        window.HAUREA_SUPABASE_READY = true;

        // Avisar o resto do site de que o Supabase está pronto a usar.
        // Como este ficheiro carrega antes do auth.js e do script.js,
        // eles verificam primeiro se window.supabaseClient já existe.
        document.dispatchEvent(new CustomEvent("supabase:ready"));

        console.log(`${LOG_PREFIX} Supabase inicializado com sucesso!`);
    } catch (erro) {
        window.HAUREA_SUPABASE_READY = false;
        console.error(`${LOG_PREFIX} erro ao criar o cliente Supabase:`, erro);
    }
})();