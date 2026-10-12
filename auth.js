/* ==========================================================================
   HAUREA DIGITAL — Autenticação (login, registo e terminar sessão)
   Requer: o ficheiro que cria window.supabaseClient carregado ANTES deste
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

    // Se faltar algum elemento no HTML, avisa em vez de rebentar
    const emFalta = Object.entries(el)
        .filter(([, elemento]) => !elemento)
        .map(([nome]) => nome);

    if (emFalta.length > 0) {
        console.error(
            "HAUREA DIGITAL: elementos em falta no HTML:",
            emFalta.join(", ")
        );
        return;
    }

    // ---------------------------------------------------------------------
    // Estado
    // ---------------------------------------------------------------------
    const MIN_PASSWORD = 8;
    const ESPERA_SUPABASE_MS = 5000;

    let mode = "login";
    let busy = false;
    let supabaseClient = null;

    // ---------------------------------------------------------------------
    // Funções auxiliares
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

        if (msg.includes("invalid login credentials")) {
            return "Email ou palavra-passe incorretos.";
        }
        if (msg.includes("email not confirmed")) {
            return "Confirme o seu email antes de iniciar sessão.";
        }
        if (msg.includes("already registered")) {
            return "Este email já está registado. Inicie sessão.";
        }
        if (msg.includes("rate limit") || error?.status === 429) {
            return "Demasiadas tentativas. Aguarde um pouco e tente novamente.";
        }
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Sem ligação à internet. Verifique e tente novamente.";
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
        return mode === "register" ? "Criar conta" : "Iniciar sessão";
    }

    function setBusy(estado) {
        busy = estado;
        el.submitButton.disabled = estado;
        el.submitButton.textContent = estado ? "A processar..." : textoDoBotao();
    }

    function setMode(newMode) {
        mode = newMode;
        const registering = mode === "register";

        el.nameField.hidden = !registering;
        el.nameInput.required = registering;
        el.passwordInput.autocomplete = registering
            ? "new-password"
            : "current-password";

        el.loginTab.classList.toggle("active", !registering);
        el.registerTab.classList.toggle("active", registering);

        el.submitButton.textContent = textoDoBotao();
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

    /** Espera (até 5 segundos) que o cliente Supabase fique disponível. */
    async function esperarSupabase() {
        const tentativas = ESPERA_SUPABASE_MS / 100;

        for (let i = 0; i < tentativas; i++) {
            if (window.supabaseClient) return window.supabaseClient;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return window.supabaseClient || null;
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
                data: { full_name: fullName }
            }
        });

        if (error) throw error;

        // Com confirmação de email ativa, um email já existente devolve
        // um utilizador sem identidades (o Supabase não dá erro).
        if (data.user && data.user.identities?.length === 0) {
            showMessage("Este email já está registado. Inicie sessão.", "error");
            return;
        }

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

        updatePage(data.user);
        window.location.hash = "#inicio";
    }

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------
    el.loginTab.addEventListener("click", () => {
        if (!busy) setMode("login");
    });

    el.registerTab.addEventListener("click", () => {
        if (!busy) setMode("register");
    });

    el.authForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy) return;

        if (!supabaseClient) {
            showMessage("A ligar ao serviço. Tente novamente num instante.", "error");
            return;
        }

        const email = el.emailInput.value.trim();
        const password = el.passwordInput.value;
        const fullName = el.nameInput.value.trim();

        if (!email || !password) {
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
            window.location.hash = "";
        } catch (error) {
            console.error("Erro ao terminar sessão:", error);
            alert("Não foi possível terminar a sessão.");
        }
    });

    // ---------------------------------------------------------------------
    // Arranque
    // ---------------------------------------------------------------------
    setMode("login");

    // Bloqueia o formulário até o Supabase estar pronto
    el.submitButton.disabled = true;

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

    el.submitButton.disabled = false;

    try {
        const { data, error } = await supabaseClient.auth.getSession();

        if (error) throw error;

        updatePage(data.session?.user || null);

        // Mantém a página sincronizada (login noutro separador, sessão expirada...)
        supabaseClient.auth.onAuthStateChange((_event, session) => {
            updatePage(session?.user || null);
        });
    } catch (error) {
        console.error("Erro ao verificar sessão:", error);
        showMessage("Não foi possível verificar a sessão.", "error");
    }
});