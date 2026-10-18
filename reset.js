/* ==========================================================================
   HAUREA DIGITAL — Nova palavra-passe (reset.js)
   Página aberta pelo link enviado por email.
   Requer: supabase-init.js carregado ANTES.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    "use strict";

    const MIN_PASSWORD = 8;
    const MAX_PASSWORD = 72; // limite do Supabase
    const ESPERA_SUPABASE_MS = 5000;
    const ESPERA_VALIDACAO_MS = 4000;
    const CHAVE_RECUPERACAO = "haureaRecovery";

    const $ = (id) => document.getElementById(id);

    const el = {
        form: $("resetForm"),
        newPassword: $("newPassword"),
        confirmPassword: $("confirmPassword"),
        submit: $("resetSubmit"),
        message: $("resetMessage"),
        intro: $("resetIntro"),
        back: $("resetBackLink")
    };

    const emFalta = Object.entries(el)
        .filter(([, elemento]) => !elemento)
        .map(([nome]) => nome);

    if (emFalta.length > 0) {
        console.error("HAUREA DIGITAL: elementos em falta no reset.html:", emFalta.join(", "));
        return;
    }

    let pronto = false;
    let busy = false;
    let temporizadorValidacao = null;

    // ---------------------------------------------------------------------
    // Auxiliares
    // ---------------------------------------------------------------------
    function showMessage(text = "", tipo = "info") {
        el.message.textContent = text;
        el.message.classList.remove("info", "success", "error");
        if (text) el.message.classList.add(tipo);
    }

    function traduzirErro(error) {
        const msg = (error?.message || "").toLowerCase();
        const codigo = (error?.code || "").toLowerCase();

        if (codigo === "same_password" || msg.includes("different from the old")) {
            return "A nova palavra-passe tem de ser diferente da anterior.";
        }
        if (
            codigo === "session_not_found" ||
            codigo === "bad_jwt" ||
            msg.includes("session") ||
            msg.includes("jwt") ||
            msg.includes("not authenticated")
        ) {
            return "O link expirou. Peça um novo link na página de início de sessão.";
        }
        if (codigo === "weak_password" || msg.includes("password")) {
            return "A palavra-passe é demasiado fraca. Use letras, números e mais caracteres.";
        }
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Sem ligação à internet. Verifique e tente novamente.";
        }

        return "Não foi possível guardar a palavra-passe. Tente novamente.";
    }

    /** Espera (até 5 segundos) que o cliente Supabase fique disponível. */
    function esperarSupabase() {
        if (window.supabaseClient) return Promise.resolve(window.supabaseClient);

        return new Promise((resolve) => {
            const terminar = () => {
                clearTimeout(limite);
                document.removeEventListener("supabase:ready", terminar);
                resolve(window.supabaseClient || null);
            };

            const limite = setTimeout(terminar, ESPERA_SUPABASE_MS);
            document.addEventListener("supabase:ready", terminar);
        });
    }

    function ativarFormulario() {
        if (pronto) return;
        pronto = true;

        clearTimeout(temporizadorValidacao);

        el.intro.textContent = "Escolha uma nova palavra-passe para a sua conta.";
        el.form.hidden = false;
        el.back.hidden = true;
        showMessage("");
        el.newPassword.focus();
    }

    function mostrarLinkInvalido(texto) {
        if (pronto) return;

        clearTimeout(temporizadorValidacao);
        sessionStorage.removeItem(CHAVE_RECUPERACAO);

        el.form.hidden = true;
        el.intro.textContent = "Não foi possível validar o pedido.";
        el.back.hidden = false;
        showMessage(texto, "error");
    }

    function setBusy(estado) {
        busy = estado;
        el.submit.disabled = estado;
        el.submit.textContent = estado ? "A guardar..." : "Guardar nova palavra-passe";
    }

    // ---------------------------------------------------------------------
    // Validar o link de recuperação
    // ---------------------------------------------------------------------
    const client = await esperarSupabase();

    if (!client) {
        console.error("HAUREA DIGITAL: window.supabaseClient não foi criado.");
        el.intro.textContent = "Não foi possível ligar ao serviço.";
        showMessage("Recarregue a página (Ctrl + F5).", "error");
        return;
    }

    if (window.HAUREA_LINK_ERROR) {
        mostrarLinkInvalido(
            "Este link expirou ou já foi usado. Peça um novo link na página de início de sessão."
        );
        return;
    }

    // O evento pode já ter passado antes deste ponto; por isso há também o getSession abaixo
    client.auth.onAuthStateChange((evento) => {
        if (evento === "PASSWORD_RECOVERY") ativarFormulario();
    });

    const veioDoLink =
        window.HAUREA_RECOVERY_LINK === true ||
        sessionStorage.getItem(CHAVE_RECUPERACAO) === "1";

    if (!veioDoLink) {
        mostrarLinkInvalido("Abra esta página através do link enviado para o seu email.");
        return;
    }

    try {
        const { data } = await client.auth.getSession();

        if (data.session) {
            ativarFormulario();
        } else {
            temporizadorValidacao = setTimeout(() => {
                mostrarLinkInvalido(
                    "Não foi possível validar o link. Peça um novo link na página de início de sessão."
                );
            }, ESPERA_VALIDACAO_MS);
        }
    } catch (error) {
        console.error("Erro ao validar a sessão de recuperação:", error);
        mostrarLinkInvalido("Não foi possível validar o link. Peça um novo link.");
    }

    // ---------------------------------------------------------------------
    // Guardar a nova palavra-passe
    // ---------------------------------------------------------------------
    el.form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy || !pronto) return;

        const password = el.newPassword.value;
        const confirmacao = el.confirmPassword.value;

        if (password.length < MIN_PASSWORD) {
            showMessage(`A palavra-passe deve ter pelo menos ${MIN_PASSWORD} caracteres.`, "error");
            return;
        }

        if (password.length > MAX_PASSWORD) {
            showMessage(`A palavra-passe não pode ter mais de ${MAX_PASSWORD} caracteres.`, "error");
            return;
        }

        if (password !== confirmacao) {
            showMessage("As palavras-passe não são iguais.", "error");
            return;
        }

        setBusy(true);
        showMessage("");

        try {
            const { error } = await client.auth.updateUser({ password });

            if (error) throw error;

            sessionStorage.removeItem(CHAVE_RECUPERACAO);

            // Bloqueia o formulário (já está concluído) e limpa os campos
            el.newPassword.value = "";
            el.confirmPassword.value = "";
            el.newPassword.disabled = true;
            el.confirmPassword.disabled = true;
            el.submit.textContent = "Palavra-passe guardada";

            showMessage(
                "Palavra-passe alterada com sucesso! A redirecionar para o início de sessão...",
                "success"
            );

            try {
                await client.auth.signOut();
            } catch (erroSaida) {
                console.warn("Aviso ao terminar a sessão de recuperação:", erroSaida);
            }

            el.back.hidden = false;
            setTimeout(() => window.location.replace("index.html"), 2500);
        } catch (error) {
            console.error("Erro ao guardar a palavra-passe:", error);
            showMessage(traduzirErro(error), "error");
            setBusy(false);
        }
    });
});