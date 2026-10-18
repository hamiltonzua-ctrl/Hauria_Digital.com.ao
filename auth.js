/* ==========================================================================
   HAUREA DIGITAL — Autenticação
   Login, registo, recuperação de palavra-passe e terminar sessão.
   Requer: supabase-init.js (cria window.supabaseClient) carregado ANTES.
   ========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
    "use strict";

    // ---------------------------------------------------------------------
    // Elementos da página
    // ---------------------------------------------------------------------
    const el = {
        authPage: document.getElementById("authPage"),
        appContent: document.getElementById("appContent"),
        authForm: document.getElementById("authForm"),
        nameField: document.getElementById("authNameField"),
        nameInput: document.getElementById("authName"),
        emailInput: document.getElementById("authEmail"),
        passwordInput: document.getElementById("authPassword"),
        authMessage: document.getElementById("authMessage"),
        submitButton: document.getElementById("authSubmit"),
        loginTab: document.getElementById("authModeLogin"),
        registerTab: document.getElementById("authModeRegister"),
        logoutBtn: document.getElementById("logoutBtn"),
        welcomeUser: document.getElementById("welcomeUser")
    };

    // Elementos da recuperação de palavra-passe.
    // São opcionais: se faltarem no HTML, o login continua a funcionar.
    const extra = {
        passwordField: document.getElementById("authPasswordField"),
        forgotBtn: document.getElementById("forgotPasswordBtn"),
        backBtn: document.getElementById("backToLoginBtn"),
        tabs: document.querySelector(".auth-tabs"),
        intro: document.querySelector(".auth-intro")
    };

    // Se faltar algum elemento obrigatório no HTML, avisa em vez de rebentar
    const emFalta = Object.entries(el)
        .filter(([, elemento]) => !elemento)
        .map(([nome]) => nome);

    if (emFalta.length > 0) {
        console.error("HAUREA DIGITAL: elementos em falta no HTML:", emFalta.join(", "));
        return;
    }

    // ---------------------------------------------------------------------
    // Constantes e estado
    // ---------------------------------------------------------------------
    const MIN_PASSWORD = 8;
    const ESPERA_SUPABASE_MS = 5000;
    const ESPERA_RECUPERACAO_S = 60;

    const TEXTO_INTRO_ORIGINAL = extra.intro ? extra.intro.textContent : "";
    const TEXTO_INTRO_RECUPERAR =
        "Indique o email da sua conta e enviamos um link para criar uma nova palavra-passe.";

    let mode = "login"; // "login" | "register" | "forgot"
    let busy = false;
    let supabaseClient = null;

    let cooldownAte = 0;      // momento (ms) em que acaba a espera entre links
    let cooldownTimer = null;

    // ---------------------------------------------------------------------
    // Mensagens e textos
    // ---------------------------------------------------------------------

    /** Mostra uma mensagem. tipo: "info" | "success" | "error" */
    function showMessage(text = "", tipo = "info") {
        el.authMessage.textContent = text;
        el.authMessage.classList.remove("info", "success", "error");

        if (text) {
            el.authMessage.classList.add(tipo);
        }
    }

    /** Traduz os erros do Supabase para português. */
    function traduzirErro(error) {
        const msg = (error?.message || "").toLowerCase();
        const codigo = (error?.code || "").toLowerCase();

        if (codigo === "invalid_credentials" || msg.includes("invalid login credentials")) {
            return "Email ou palavra-passe incorretos.";
        }
        if (codigo === "email_not_confirmed" || msg.includes("email not confirmed")) {
            return "Confirme o seu email antes de iniciar sessão.";
        }
        if (codigo === "user_already_exists" || msg.includes("already registered")) {
            return "Este email já está registado. Inicie sessão.";
        }
        if (msg.includes("security purposes")) {
            return "Por segurança, aguarde cerca de um minuto antes de pedir outro link.";
        }
        if (codigo.includes("rate_limit") || msg.includes("rate limit") || error?.status === 429) {
            return "Demasiadas tentativas. Aguarde um pouco e tente novamente.";
        }
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Sem ligação à internet. Verifique e tente novamente.";
        }
        if (codigo === "weak_password" || msg.includes("weak")) {
            return "A palavra-passe é demasiado fraca. Use letras, números e símbolos.";
        }
        if (msg.includes("password")) {
            return "A palavra-passe não é válida. Tente outra mais forte.";
        }
        if (msg.includes("email")) {
            return "O email introduzido não é válido.";
        }

        return "Não foi possível concluir a operação. Tente novamente.";
    }

    function textoDoBotao() {
        if (mode === "register") return "Criar conta";
        if (mode === "forgot") return "Enviar link de recuperação";
        return "Iniciar sessão";
    }

    // ---------------------------------------------------------------------
    // Botão principal (um único sítio decide o seu estado)
    // ---------------------------------------------------------------------

    /** Há uma espera ativa entre pedidos de recuperação? */
    function emCooldown() {
        return mode === "forgot" && cooldownAte > Date.now();
    }

    function atualizarBotao() {
        clearTimeout(cooldownTimer);
        cooldownTimer = null;

        if (emCooldown()) {
            const restante = Math.ceil((cooldownAte - Date.now()) / 1000);

            el.submitButton.disabled = true;
            el.submitButton.textContent = `Enviar novamente (${restante}s)`;
            cooldownTimer = setTimeout(atualizarBotao, 1000);
            return;
        }

        cooldownAte = 0;

        // Fica bloqueado enquanto processa ou até o Supabase estar pronto
        el.submitButton.disabled = busy || !supabaseClient;
        el.submitButton.textContent = busy ? "A processar..." : textoDoBotao();
    }

    function setBusy(estado) {
        busy = estado;
        atualizarBotao();
    }

    /** Impede pedidos de recuperação em sequência (o Supabase limita o envio de emails). */
    function startCooldown(segundos = ESPERA_RECUPERACAO_S) {
        cooldownAte = Date.now() + segundos * 1000;
        atualizarBotao();
    }

    // ---------------------------------------------------------------------
    // Modos do formulário
    // ---------------------------------------------------------------------
    function setMode(newMode) {
        mode = newMode;

        const registering = mode === "register";
        const recovering = mode === "forgot";

        el.nameField.hidden = !registering;
        el.nameInput.required = registering;

        if (extra.passwordField) extra.passwordField.hidden = recovering;
        el.passwordInput.required = !recovering;
        el.passwordInput.autocomplete = registering
            ? "new-password"
            : "current-password";

        if (extra.tabs) extra.tabs.hidden = recovering;
        if (extra.forgotBtn) extra.forgotBtn.hidden = mode !== "login";
        if (extra.backBtn) extra.backBtn.hidden = !recovering;
        if (extra.intro) {
            extra.intro.textContent = recovering
                ? TEXTO_INTRO_RECUPERAR
                : TEXTO_INTRO_ORIGINAL;
        }

        el.loginTab.classList.toggle("active", mode === "login");
        el.registerTab.classList.toggle("active", registering);

        atualizarBotao();
        showMessage("");
    }

    function updatePage(user) {
        const loggedIn = Boolean(user);

        el.authPage.hidden = loggedIn;
        el.appContent.hidden = !loggedIn;

        el.welcomeUser.textContent = loggedIn
            ? `Olá, ${user.user_metadata?.full_name || user.email}`
            : "";
    }

    /** Tira o "#" do endereço sem recarregar a página. */
    function limparHash() {
        history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    // ---------------------------------------------------------------------
    // Endereços (funcionam no GitHub Pages e em local)
    // ---------------------------------------------------------------------
    function enderecoReset() {
        return typeof window.haureaUrl === "function"
            ? window.haureaUrl("reset.html")
            : new URL("reset.html", window.location.href).href;
    }

    function enderecoSite() {
        return typeof window.haureaUrl === "function"
            ? window.haureaUrl("index.html")
            : new URL("index.html", window.location.href).href;
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

    // ---------------------------------------------------------------------
    // Registo
    // ---------------------------------------------------------------------
    async function registar(email, password, fullName) {
        showMessage("A criar a sua conta...");

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: fullName },
                emailRedirectTo: enderecoSite()
            }
        });

        if (error) throw error;

        // Com confirmação de email ativa, um email já existente devolve
        // um utilizador sem identidades (o Supabase não dá erro).
        if (data.user && data.user.identities?.length === 0) {
            showMessage("Este email já está registado. Inicie sessão.", "error");
            return;
        }

        el.passwordInput.value = "";

        if (data.session) {
            updatePage(data.session.user);
            window.location.hash = "#inicio";
            return;
        }

        setMode("login");
        el.emailInput.value = email;
        showMessage(
            "Conta registada! Confirme o email e depois inicie sessão.",
            "success"
        );
    }

    // ---------------------------------------------------------------------
    // Início de sessão
    // ---------------------------------------------------------------------
    async function iniciarSessao(email, password) {
        showMessage("A iniciar sessão...");

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        el.passwordInput.value = "";
        updatePage(data.user);
        window.location.hash = "#inicio";
    }

    // ---------------------------------------------------------------------
    // Recuperação de palavra-passe
    // ---------------------------------------------------------------------
    async function recuperarPalavraPasse(email) {
        showMessage("A enviar o link de recuperação...");

        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: enderecoReset()
        });

        if (error) throw error;

        // A mesma mensagem existindo ou não conta com este email (privacidade)
        showMessage(
            "Se existir uma conta com este email, enviámos um link para definir uma nova palavra-passe. Verifique também a pasta de spam.",
            "success"
        );

        startCooldown();
    }

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------
    el.loginTab.addEventListener("click", () => {
        if (busy) return;
        setMode("login");
        el.emailInput.focus();
    });

    el.registerTab.addEventListener("click", () => {
        if (busy) return;
        setMode("register");
        el.nameInput.focus();
    });

    if (extra.forgotBtn) {
        extra.forgotBtn.addEventListener("click", () => {
            if (busy) return;

            // Aproveita o email que o cliente já escreveu
            const emailEscrito = el.emailInput.value;
            setMode("forgot");
            el.emailInput.value = emailEscrito;
            el.emailInput.focus();
        });
    }

    if (extra.backBtn) {
        extra.backBtn.addEventListener("click", () => {
            if (busy) return;
            setMode("login");
            el.emailInput.focus();
        });
    }

    el.authForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy || emCooldown()) return;

        if (!supabaseClient) {
            showMessage("A ligar ao serviço. Tente novamente num instante.", "error");
            return;
        }

        const email = el.emailInput.value.trim().toLowerCase();
        const password = el.passwordInput.value;
        const fullName = el.nameInput.value.trim().slice(0, 100);

        if (!email) {
            showMessage("Introduza o seu email.", "error");
            return;
        }

        if (mode !== "forgot" && !password) {
            showMessage("Preencha o email e a palavra-passe.", "error");
            return;
        }

        if (mode === "register") {
            if (!fullName) {
                showMessage("Introduza o seu nome completo.", "error");
                return;
            }

            // O mínimo só vale para contas novas, para não bloquear
            // quem já tem uma palavra-passe mais curta.
            if (password.length < MIN_PASSWORD) {
                showMessage(
                    `A palavra-passe deve ter pelo menos ${MIN_PASSWORD} caracteres.`,
                    "error"
                );
                return;
            }
        }

        setBusy(true);

        try {
            if (mode === "register") {
                await registar(email, password, fullName);
            } else if (mode === "forgot") {
                await recuperarPalavraPasse(email);
            } else {
                await iniciarSessao(email, password);
            }
        } catch (error) {
            console.error("Erro de autenticação:", error);
            showMessage(traduzirErro(error), "error");
        } finally {
            setBusy(false);
        }
    });

    el.logoutBtn.addEventListener("click", async () => {
        if (!supabaseClient) return;

        try {
            const { error } = await supabaseClient.auth.signOut();

            if (error) throw error;

            updatePage(null);
            el.authForm.reset();
            setMode("login");
            limparHash();
            window.scrollTo(0, 0);
        } catch (error) {
            console.error("Erro ao terminar sessão:", error);
            alert("Não foi possível terminar a sessão.");
        }
    });

    // ---------------------------------------------------------------------
    // Arranque
    // ---------------------------------------------------------------------
    setMode("login"); // o botão fica bloqueado até o Supabase estar pronto

    supabaseClient = await esperarSupabase();

    if (!supabaseClient) {
        console.error(
            "HAUREA DIGITAL: window.supabaseClient não foi criado. " +
            "Confirme que o ficheiro de ligação ao Supabase está no HTML antes do auth.js."
        );
        showMessage(
            "Não foi possível ligar ao serviço. Recarregue a página (Ctrl + F5).",
            "error"
        );
        return;
    }

    atualizarBotao();

    try {
        const { data, error } = await supabaseClient.auth.getSession();

        if (error) throw error;

        updatePage(data.session?.user || null);

        // Mantém a página sincronizada (login noutro separador, sessão expirada...)
        supabaseClient.auth.onAuthStateChange((evento, session) => {
            // Rede de segurança: se o link de recuperação abrir aqui por engano,
            // leva o cliente para a página certa em vez de o deixar entrar no site.
            if (evento === "PASSWORD_RECOVERY") {
                sessionStorage.setItem("haureaRecovery", "1");
                window.location.replace(enderecoReset());
                return;
            }

            updatePage(session?.user || null);
        });
    } catch (error) {
        console.error("Erro ao verificar sessão:", error);
        showMessage("Não foi possível verificar a sessão.", "error");
    }
});