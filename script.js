/* ==========================================================================
   HAUREA DIGITAL — Pedidos de serviço ("Refina o meu ouro")
   Requer: supabase-init.js carregado ANTES deste ficheiro no HTML
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    // ---------------------------------------------------------------------
    // Elementos da página
    // ---------------------------------------------------------------------
    const el = {
        form: document.getElementById("serviceRequestForm"),
        serviceInput: document.getElementById("service"),
        descriptionInput: document.getElementById("description"),
        message: document.getElementById("requestMessage"),
        submitBtn: document.getElementById("submitRequestBtn"),
        loadBtn: document.getElementById("loadRequestsBtn"),
        requestsContainer: document.getElementById("myRequests")
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
    // Configuração e estado
    // ---------------------------------------------------------------------
    const WHATSAPP_NUMBER = "244976231794";
    const MIN_DESCRIPTION = 10;
    const MAX_DESCRIPTION = 1000; // evita links do WhatsApp demasiado longos

    const TEXTO_ENVIAR = el.submitBtn.textContent;
    const TEXTO_CARREGAR = el.loadBtn.textContent;

    const ESTADOS = {
        pending: "Pendente",
        pendente: "Pendente",
        in_progress: "Em andamento",
        "em andamento": "Em andamento",
        completed: "Concluído",
        concluido: "Concluído",
        concluído: "Concluído",
        cancelled: "Cancelado",
        cancelado: "Cancelado"
    };

    let sending = false;
    let loadingRequests = false;

    // ---------------------------------------------------------------------
    // Funções auxiliares
    // ---------------------------------------------------------------------

    /** Mostra uma mensagem. tipo: "info" | "success" | "error" */
    function showMessage(text = "", tipo = "info", linkUrl = null) {
        el.message.replaceChildren();

        if (!text) return;

        const textNode = document.createElement("span");
        textNode.className = `msg-${tipo}`;
        textNode.textContent = text;
        el.message.appendChild(textNode);

        if (linkUrl) {
            el.message.appendChild(document.createElement("br"));

            const link = document.createElement("a");
            link.href = linkUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "botao-principal msg-link";
            link.textContent = "Enviar pedido pelo WhatsApp";
            el.message.appendChild(link);
        }
    }

    function setSending(estado) {
        sending = estado;
        el.submitBtn.disabled = estado;
        el.submitBtn.textContent = estado ? "A enviar..." : TEXTO_ENVIAR;
    }

    function setLoadingRequests(estado) {
        loadingRequests = estado;
        el.loadBtn.disabled = estado;
        el.loadBtn.textContent = estado ? "A carregar..." : TEXTO_CARREGAR;
    }

    function mostrarNoContentor(texto) {
        el.requestsContainer.replaceChildren();

        const paragrafo = document.createElement("p");
        paragrafo.textContent = texto;
        el.requestsContainer.appendChild(paragrafo);
    }

    function traduzirEstado(estado) {
        const chave = String(estado || "").trim().toLowerCase();
        return ESTADOS[chave] || estado || "Pendente";
    }

    function formatarData(valor) {
        const data = new Date(valor);

        return Number.isNaN(data.getTime())
            ? ""
            : data.toLocaleString("pt-PT");
    }

    async function getCurrentUser() {
        if (!window.supabaseClient) {
            throw new Error("O Supabase não está inicializado.");
        }

        const { data, error } = await window.supabaseClient.auth.getUser();

        if (error) throw error;
        return data.user;
    }

    function criarLinkWhatsApp({ clientName, email, service, description }) {
        const texto =
            "✨ *NOVO PEDIDO — HAUREA DIGITAL* ✨\n\n" +
            "👤 *Cliente:* " + clientName + "\n" +
            "📧 *Email:* " + email + "\n" +
            "💼 *Serviço:* " + service + "\n\n" +
            "📝 *Descrição da ideia:*\n" + description + "\n\n" +
            "Recebido através do formulário Refina o meu ouro.";

        return (
            "https://wa.me/" + WHATSAPP_NUMBER +
            "?text=" + encodeURIComponent(texto)
        );
    }

    function criarCartao(pedido) {
        const card = document.createElement("article");
        card.className = "servico";

        const title = document.createElement("h3");
        title.textContent = pedido.service;

        const description = document.createElement("p");
        description.textContent = pedido.description;

        const status = document.createElement("p");
        status.textContent = "Estado: " + traduzirEstado(pedido.status);

        const date = document.createElement("small");
        date.textContent = formatarData(pedido.created_at);

        card.append(title, description, status, date);
        return card;
    }

    // ---------------------------------------------------------------------
    // Listar os pedidos do cliente
    // ---------------------------------------------------------------------
    async function loadRequests() {
        if (loadingRequests) return;

        setLoadingRequests(true);

        try {
            const client = window.supabaseClient;

            if (!client) throw new Error("O Supabase não está inicializado.");

            const user = await getCurrentUser();

            if (!user) {
                mostrarNoContentor("Inicie sessão para consultar os seus pedidos.");
                return;
            }

            const { data, error } = await client
                .from("service_requests")
                .select("service, description, status, created_at")
                .eq("client_id", user.id)
                .order("created_at", { ascending: false });

            if (error) throw error;

            if (!data || data.length === 0) {
                mostrarNoContentor("Ainda não tem pedidos.");
                return;
            }

            el.requestsContainer.replaceChildren(...data.map(criarCartao));
        } catch (error) {
            console.error("Erro ao consultar pedidos:", error);
            mostrarNoContentor("Não foi possível consultar os pedidos.");
        } finally {
            setLoadingRequests(false);
        }
    }

    // ---------------------------------------------------------------------
    // Enviar um novo pedido
    // ---------------------------------------------------------------------
    async function enviarPedido(event) {
        event.preventDefault();

        if (sending) return;

        const service = el.serviceInput.value;
        const description = el.descriptionInput.value.trim();

        if (!service || description.length < MIN_DESCRIPTION) {
            showMessage(
                `Escolha um serviço e explique a sua ideia com pelo menos ${MIN_DESCRIPTION} caracteres.`,
                "error"
            );
            return;
        }

        if (description.length > MAX_DESCRIPTION) {
            showMessage(
                `A descrição é demasiado longa. Use no máximo ${MAX_DESCRIPTION} caracteres (tem ${description.length}).`,
                "error"
            );
            return;
        }

        setSending(true);
        showMessage("A registar o pedido...");

        try {
            const client = window.supabaseClient;

            if (!client) throw new Error("O Supabase não está inicializado.");

            const user = await getCurrentUser();

            if (!user) {
                showMessage("Inicie sessão antes de enviar um pedido.", "error");
                return;
            }

            const { error } = await client
                .from("service_requests")
                .insert({
                    client_id: user.id,
                    service,
                    description
                });

            if (error) throw error;

            const whatsappURL = criarLinkWhatsApp({
                clientName: user.user_metadata?.full_name || "Não informado",
                email: user.email,
                service,
                description
            });

            showMessage(
                "Pedido guardado com sucesso! Envie agora a mensagem.",
                "success",
                whatsappURL
            );

            el.form.reset();
            await loadRequests();
        } catch (error) {
            console.error("Erro ao enviar pedido:", error);
            showMessage(
                "Não foi possível guardar o pedido. Verifique a sua ligação e tente novamente.",
                "error"
            );
        } finally {
            setSending(false);
        }
    }

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------
    el.form.addEventListener("submit", enviarPedido);
    el.loadBtn.addEventListener("click", loadRequests);
});