/* ==========================================================================
   HAUREA DIGITAL — Pedidos de serviço ("Refina o meu ouro")
   Enviar, consultar, editar e apagar pedidos.
   Requer: supabase-init.js (cria window.supabaseClient) carregado ANTES.
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
        console.error("HAUREA DIGITAL: elementos em falta no HTML:", emFalta.join(", "));
        return;
    }

    // ---------------------------------------------------------------------
    // Configuração e estado
    // ---------------------------------------------------------------------
    const WHATSAPP_NUMBER = "244976231794";
    const MIN_DESCRIPTION = 10;
    const MAX_DESCRIPTION = 1000; // evita links do WhatsApp demasiado longos
    const ESPERA_SUPABASE_MS = 5000;

    const TEXTO_ENVIAR = el.submitBtn.textContent;
    const TEXTO_CARREGAR = el.loadBtn.textContent;

    const ESTADOS = {
        pending: "Pendente",
        pendente: "Pendente",
        in_progress: "Em andamento",
        "em andamento": "Em andamento",
        completed: "Concluído",
        concluido: "Concluído",
        "concluído": "Concluído",
        cancelled: "Cancelado",
        canceled: "Cancelado",
        cancelado: "Cancelado"
    };

    const CLASSES_ESTADO = {
        "Pendente": "estado-pendente",
        "Em andamento": "estado-andamento",
        "Concluído": "estado-concluido",
        "Cancelado": "estado-cancelado"
    };

    // O cliente só pode editar/apagar pedidos neste estado
    // (a regra verdadeira está no RLS do Supabase).
    const ESTADO_EDITAVEL = "Pendente";

    let sending = false;
    let loadingRequests = false;

    // ---------------------------------------------------------------------
    // Supabase
    // ---------------------------------------------------------------------

    /** Devolve o cliente Supabase ou lança erro se não estiver inicializado */
    function getClient() {
        if (!window.supabaseClient) {
            throw new Error("O Supabase não está inicializado.");
        }
        return window.supabaseClient;
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

    /**
     * Utilizador com sessão iniciada, ou null se não houver.
     * (A segurança real está no RLS do Supabase, não aqui.)
     */
    async function getCurrentUser() {
        const { data, error } = await getClient().auth.getSession();

        if (error) throw error;
        return data.session?.user ?? null;
    }

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

    /** Mensagem de erro percetível para o cliente. */
    function mensagemDeErro(error, padrao) {
        const msg = String(error?.message || "").toLowerCase();

        if (error?.code === "PEDIDO_BLOQUEADO") {
            return "Este pedido já não pode ser alterado (já foi aceite ou foi removido). Consulte os pedidos de novo.";
        }
        if (error?.code === "SEM_SESSAO") {
            return "A sua sessão terminou. Inicie sessão novamente.";
        }
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Sem ligação à internet. Verifique e tente novamente.";
        }
        if (error?.code === "PGRST301" || msg.includes("jwt")) {
            return "A sua sessão expirou. Inicie sessão novamente.";
        }
        if (error?.code === "42501" || msg.includes("row-level security")) {
            return "Sem permissão para esta operação. Termine a sessão e entre de novo.";
        }

        return padrao;
    }

    function criarErro(codigo) {
        const erro = new Error(codigo);
        erro.code = codigo;
        return erro;
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
        return ESTADOS[chave] || "Pendente";
    }

    function formatarData(valor) {
        const data = new Date(valor);

        if (Number.isNaN(data.getTime())) return "";

        return data.toLocaleString("pt-AO", {
            dateStyle: "short",
            timeStyle: "short"
        });
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

    /** Apaga tudo o que é de um cliente (usado ao terminar a sessão). */
    function limparDadosDoCliente() {
        el.requestsContainer.replaceChildren();
        showMessage("");
        el.form.reset();
    }

    // ---------------------------------------------------------------------
    // Cartões dos pedidos (ver, editar, confirmar remoção)
    // ---------------------------------------------------------------------

    function criarBotao(texto, classe, aoClicar, tipo = "button") {
        const botao = document.createElement("button");
        botao.type = tipo;
        botao.className = `pedido-botao ${classe}`.trim();
        botao.textContent = texto;

        if (aoClicar) botao.addEventListener("click", aoClicar);

        return botao;
    }

    /** Mensagem dentro de um cartão. tipo: "info" | "success" | "error" */
    function mensagemDoCartao(elemento, texto = "", tipo = "info") {
        elemento.textContent = texto;
        elemento.className = texto ? `pedido-msg msg-${tipo}` : "pedido-msg";
    }

    function criarMensagemDoCartao() {
        const p = document.createElement("p");
        p.className = "pedido-msg";
        p.setAttribute("role", "status");
        p.setAttribute("aria-live", "polite");
        return p;
    }

    /** Serviços disponíveis (os mesmos do formulário de novo pedido). */
    function opcoesDeServico(atual) {
        const valores = Array.from(el.serviceInput.options)
            .map((opcao) => opcao.value)
            .filter(Boolean);

        // Se o serviço antigo já não existir na lista, não se perde
        if (atual && !valores.includes(atual)) valores.unshift(atual);

        return valores;
    }

    function criarCartao(pedido) {
        const card = document.createElement("article");
        card.className = "servico";
        card.dataset.id = pedido.id;

        desenharVista(card, pedido);
        return card;
    }

    /** Vista normal do pedido. */
    function desenharVista(card, pedido) {
        card.classList.remove("em-edicao");

        const title = document.createElement("h3");
        title.textContent = pedido.service;

        const description = document.createElement("p");
        description.textContent = pedido.description;

        const estado = traduzirEstado(pedido.status);
        const status = document.createElement("p");
        status.append("Estado: ");

        const etiqueta = document.createElement("span");
        etiqueta.className = `estado-etiqueta ${CLASSES_ESTADO[estado] || ""}`;
        etiqueta.textContent = estado;
        status.appendChild(etiqueta);

        const date = document.createElement("small");
        date.textContent = formatarData(pedido.created_at);

        card.replaceChildren(title, description, status, date);

        // Só os pedidos pendentes podem ser alterados
        if (estado === ESTADO_EDITAVEL && pedido.id) {
            const acoes = document.createElement("div");
            acoes.className = "pedido-acoes";

            acoes.append(
                criarBotao("Editar", "", () => desenharEdicao(card, pedido)),
                criarBotao("Apagar", "pedido-botao-perigo", () => desenharConfirmacao(card, pedido))
            );

            card.appendChild(acoes);
        }
    }

    /** Formulário de edição dentro do cartão. */
    function desenharEdicao(card, pedido) {
        card.classList.add("em-edicao");

        const form = document.createElement("form");
        form.className = "pedido-edicao";
        form.noValidate = true; // a validação é feita abaixo, com mensagens em português

        const titulo = document.createElement("h3");
        titulo.textContent = "Editar pedido";

        // Serviço
        const campoServico = document.createElement("div");
        campoServico.className = "pedido-campo";

        const labelServico = document.createElement("label");
        labelServico.htmlFor = `editar-servico-${pedido.id}`;
        labelServico.textContent = "Serviço";

        const select = document.createElement("select");
        select.id = `editar-servico-${pedido.id}`;

        opcoesDeServico(pedido.service).forEach((valor) => {
            const opcao = document.createElement("option");
            opcao.value = valor;
            opcao.textContent = valor;
            opcao.selected = valor === pedido.service;
            select.appendChild(opcao);
        });

        campoServico.append(labelServico, select);

        // Descrição
        const campoDescricao = document.createElement("div");
        campoDescricao.className = "pedido-campo";

        const labelDescricao = document.createElement("label");
        labelDescricao.htmlFor = `editar-descricao-${pedido.id}`;
        labelDescricao.textContent = "A sua ideia";

        const textarea = document.createElement("textarea");
        textarea.id = `editar-descricao-${pedido.id}`;
        textarea.rows = 6;
        textarea.maxLength = MAX_DESCRIPTION;
        textarea.value = pedido.description || "";

        campoDescricao.append(labelDescricao, textarea);

        // Mensagem e botões
        const mensagem = criarMensagemDoCartao();

        const acoes = document.createElement("div");
        acoes.className = "pedido-acoes";

        const guardar = criarBotao(
            "Enviar pedido editado",
            "pedido-botao-principal",
            null,
            "submit"
        );
        const cancelar = criarBotao("Cancelar", "", () => desenharVista(card, pedido));

        acoes.append(guardar, cancelar);
        form.append(titulo, campoServico, campoDescricao, mensagem, acoes);

        form.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (card.dataset.ocupado) return;

            const service = select.value;
            const description = textarea.value.trim();

            if (!service || description.length < MIN_DESCRIPTION) {
                mensagemDoCartao(
                    mensagem,
                    `Escolha um serviço e explique a ideia com pelo menos ${MIN_DESCRIPTION} caracteres.`,
                    "error"
                );
                return;
            }

            if (description.length > MAX_DESCRIPTION) {
                mensagemDoCartao(
                    mensagem,
                    `A descrição é demasiado longa. Use no máximo ${MAX_DESCRIPTION} caracteres.`,
                    "error"
                );
                return;
            }

            if (service === pedido.service && description === (pedido.description || "").trim()) {
                mensagemDoCartao(mensagem, "Não fez nenhuma alteração.", "info");
                return;
            }

            card.dataset.ocupado = "1";
            guardar.disabled = true;
            cancelar.disabled = true;
            guardar.textContent = "A guardar...";
            mensagemDoCartao(mensagem, "");

            try {
                await atualizarPedido(pedido.id, service, description);
                await loadRequests("Pedido atualizado com sucesso.", true);
            } catch (error) {
                console.error("Erro ao editar pedido:", error);
                mensagemDoCartao(
                    mensagem,
                    mensagemDeErro(error, "Não foi possível guardar as alterações. Tente novamente."),
                    "error"
                );

                guardar.disabled = false;
                cancelar.disabled = false;
                guardar.textContent = "Enviar pedido editado";
                delete card.dataset.ocupado;
            }
        });

        card.replaceChildren(form);
        textarea.focus();
    }

    /** Pergunta de confirmação antes de apagar. */
    function desenharConfirmacao(card, pedido) {
        card.classList.add("em-edicao");

        const titulo = document.createElement("h3");
        titulo.textContent = "Apagar este pedido?";

        const resumo = document.createElement("p");
        resumo.textContent = pedido.service;

        const aviso = document.createElement("p");
        aviso.className = "pedido-aviso-apagar";
        aviso.textContent = "Esta ação não pode ser desfeita.";

        const mensagem = criarMensagemDoCartao();

        const acoes = document.createElement("div");
        acoes.className = "pedido-acoes";

        const apagar = criarBotao("Sim, apagar", "pedido-botao-perigo");
        const manter = criarBotao("Não, manter", "", () => desenharVista(card, pedido));

        apagar.addEventListener("click", async () => {
            if (card.dataset.ocupado) return;

            card.dataset.ocupado = "1";
            apagar.disabled = true;
            manter.disabled = true;
            apagar.textContent = "A apagar...";
            mensagemDoCartao(mensagem, "");

            try {
                await apagarPedido(pedido.id);
                await loadRequests("Pedido apagado.", true);
            } catch (error) {
                console.error("Erro ao apagar pedido:", error);
                mensagemDoCartao(
                    mensagem,
                    mensagemDeErro(error, "Não foi possível apagar o pedido. Tente novamente."),
                    "error"
                );

                apagar.disabled = false;
                manter.disabled = false;
                apagar.textContent = "Sim, apagar";
                delete card.dataset.ocupado;
            }
        });

        acoes.append(apagar, manter);
        card.replaceChildren(titulo, resumo, aviso, mensagem, acoes);
        manter.focus();
    }

    /** Mostra a lista de pedidos (e um aviso de sucesso por cima, se houver). */
    function mostrarLista(pedidos, aviso = "") {
        if (pedidos.length === 0) {
            mostrarNoContentor("Ainda não tem pedidos.");
        } else {
            el.requestsContainer.replaceChildren(...pedidos.map(criarCartao));
        }

        if (aviso) {
            const paragrafo = document.createElement("p");
            paragrafo.className = "pedido-aviso";
            paragrafo.setAttribute("role", "status");
            paragrafo.textContent = aviso;
            el.requestsContainer.prepend(paragrafo);
        }
    }

    // ---------------------------------------------------------------------
    // Operações na base de dados
    // ---------------------------------------------------------------------

    /** Edita um pedido do cliente. O RLS só deixa se for dele e estiver pendente. */
    async function atualizarPedido(id, service, description) {
        const user = await getCurrentUser();
        if (!user) throw criarErro("SEM_SESSAO");

        const { data, error } = await getClient()
            .from("service_requests")
            .update({ service, description })
            .eq("id", id)
            .eq("client_id", user.id)
            .select("id");

        if (error) throw error;

        // O RLS não dá erro quando bloqueia: devolve 0 linhas alteradas
        if (!data || data.length === 0) throw criarErro("PEDIDO_BLOQUEADO");
    }

    /** Apaga um pedido do cliente. O RLS só deixa se for dele e estiver pendente. */
    async function apagarPedido(id) {
        const user = await getCurrentUser();
        if (!user) throw criarErro("SEM_SESSAO");

        const { data, error } = await getClient()
            .from("service_requests")
            .delete()
            .eq("id", id)
            .eq("client_id", user.id)
            .select("id");

        if (error) throw error;

        if (!data || data.length === 0) throw criarErro("PEDIDO_BLOQUEADO");
    }

    // ---------------------------------------------------------------------
    // Listar os pedidos do cliente
    // ---------------------------------------------------------------------
    async function loadRequests(aviso = "", forcar = false) {
        if (loadingRequests && !forcar) return;

        setLoadingRequests(true);

        try {
            const client = getClient();
            const user = await getCurrentUser();

            if (!user) {
                mostrarNoContentor("Inicie sessão para consultar os seus pedidos.");
                return;
            }

            const { data, error } = await client
                .from("service_requests")
                .select("id, service, description, status, created_at")
                .eq("client_id", user.id)
                .order("created_at", { ascending: false });

            if (error) throw error;

            mostrarLista(data || [], aviso);
        } catch (error) {
            console.error("Erro ao consultar pedidos:", error);
            mostrarNoContentor(
                mensagemDeErro(error, "Não foi possível consultar os pedidos.")
            );
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
            const client = getClient();
            const user = await getCurrentUser();

            if (!user) {
                showMessage("Inicie sessão antes de enviar um pedido.", "error");
                return;
            }

            // O estado "Pendente" é definido pela base de dados
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

            el.form.reset();

            // Recarrega a lista primeiro e só depois mostra a mensagem de sucesso
            await loadRequests();

            showMessage(
                "Pedido guardado com sucesso! Envie agora a mensagem.",
                "success",
                whatsappURL
            );
        } catch (error) {
            console.error("Erro ao enviar pedido:", error);
            showMessage(
                mensagemDeErro(
                    error,
                    "Não foi possível guardar o pedido. Verifique a sua ligação e tente novamente."
                ),
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

    // (função de seta para o clique não passar o "event" como aviso)
    el.loadBtn.addEventListener("click", () => loadRequests());

    // Limpa a mensagem de sucesso (e o link do WhatsApp antigo) ao escrever outro pedido
    [el.serviceInput, el.descriptionInput].forEach((campo) => {
        campo.addEventListener("input", () => {
            if (!sending) showMessage("");
        });
    });

    // ---------------------------------------------------------------------
    // Privacidade: ao terminar a sessão, não deixa dados do cliente no ecrã
    // ---------------------------------------------------------------------
    esperarSupabase().then((client) => {
        if (!client) return;

        client.auth.onAuthStateChange((evento) => {
            if (evento === "SIGNED_OUT") limparDadosDoCliente();
        });
    });
});