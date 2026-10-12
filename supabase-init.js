/* ==========================================================================
   HAUREA DIGITAL — Inicialização do Supabase
   Colocar DEPOIS do script da biblioteca Supabase no HTML:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ========================================================================== */

(() => {
    "use strict";

    // ---------------------------------------------------------------------
    // Configuração
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
                "Confirma se o <script> da biblioteca vem antes deste ficheiro no HTML."
        );
        return;
    }

    // ---------------------------------------------------------------------
    // Validar a configuração
    // ---------------------------------------------------------------------
    const urlValido = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL);
    const chaveValida = SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

    if (!urlValido || !chaveValida) {
        console.error(
            `${LOG_PREFIX} configuração inválida. Verifica o URL e a chave pública do Supabase.`
        );
        return;
    }

    // ---------------------------------------------------------------------
    // Criar a ligação ao Supabase
    // ---------------------------------------------------------------------
    try {
        window.supabaseClient = createClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY
        );

        // Avisar o resto do site de que o Supabase está pronto a usar
        document.dispatchEvent(new CustomEvent("supabase:ready"));

        console.log(`${LOG_PREFIX} Supabase inicializado com sucesso!`);
    } catch (erro) {
        console.error(`${LOG_PREFIX} erro ao criar o cliente Supabase:`, erro);
    }
})();