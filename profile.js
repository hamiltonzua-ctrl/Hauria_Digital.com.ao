/* ==========================================================================
   HAUREA DIGITAL — Perfil do cliente (foto, nome, telefone)
   Requer: supabase-init.js carregado ANTES.
   Tabela: profiles (id, full_name, phone, avatar_path, updated_at)
   Pasta de fotos: avatars/<id-do-cliente>/avatar.jpg
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    "use strict";

    // ---------------------------------------------------------------------
    // Elementos da página
    // ---------------------------------------------------------------------
    const $ = (id) => document.getElementById(id);

    const el = {
        openBtn: $("profileBtn"),
        headerImg: $("headerAvatar"),
        headerInitials: $("headerAvatarInitials"),
        dialog: $("profileDialog"),
        form: $("profileForm"),
        avatarImg: $("profileAvatarImg"),
        avatarInitials: $("profileAvatarInitials"),
        photoInput: $("profilePhotoInput"),
        removeBtn: $("profileRemovePhoto"),
        nameInput: $("profileName"),
        phoneInput: $("profilePhone"),
        emailInput: $("profileEmail"),
        message: $("profileMessage"),
        saveBtn: $("profileSave"),
        closeBtn: $("profileClose")
    };

    const emFalta = Object.entries(el)
        .filter(([, elemento]) => !elemento)
        .map(([nome]) => nome);

    if (emFalta.length > 0) {
        console.error("HAUREA DIGITAL: elementos em falta no perfil:", emFalta.join(", "));
        return;
    }

    // ---------------------------------------------------------------------
    // Configuração e estado
    // ---------------------------------------------------------------------
    const BUCKET = "avatars";
    const TAMANHO_FOTO = 512;           // px (quadrada)
    const QUALIDADE_JPEG = 0.85;
    const MAX_FICHEIRO_MB = 15;         // antes de reduzir
    const MAX_NOME = 100;
    const ESPERA_SUPABASE_MS = 5000;
    const TEXTO_GUARDAR = el.saveBtn.textContent;

    let client = null;
    let user = null;
    let perfil = { full_name: "", phone: "", avatar_path: null, updated_at: null };

    let fotoNova = null;        // Blob JPEG já reduzido, à espera de "Guardar"
    let removerFoto = false;    // o cliente pediu para remover a foto
    let urlPrevia = null;       // URL temporário da pré-visualização
    let aGuardar = false;

    // ---------------------------------------------------------------------
    // Auxiliares
    // ---------------------------------------------------------------------
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

    /** Mostra uma mensagem. tipo: "info" | "success" | "error" */
    function showMessage(texto = "", tipo = "info") {
        el.message.textContent = texto;
        el.message.className = texto ? `pedido-msg msg-${tipo}` : "pedido-msg";
    }

    function mensagemDeErro(error, padrao) {
        const msg = String(error?.message || "").toLowerCase();

        if (error?.code === "FOTO_INVALIDA") return error.message;
        if (msg.includes("failed to fetch") || msg.includes("network")) {
            return "Sem ligação à internet. Verifique e tente novamente.";
        }
        if (msg.includes("row-level security") || error?.code === "42501" || msg.includes("not authorized")) {
            return "Sem permissão para guardar. Termine a sessão e entre de novo.";
        }
        if (msg.includes("payload too large") || msg.includes("exceeded the maximum")) {
            return "A foto é demasiado grande. Escolha outra.";
        }
        if (msg.includes("mime") || msg.includes("not supported")) {
            return "Este tipo de ficheiro não é aceite. Use JPG, PNG ou WebP.";
        }
        if (msg.includes("bucket not found")) {
            return "A pasta das fotos ainda não foi criada no Supabase (passo 1).";
        }

        return padrao;
    }

    function erroDeFoto(texto) {
        const erro = new Error(texto);
        erro.code = "FOTO_INVALIDA";
        return erro;
    }

    /** Iniciais para quando não há foto: "Elias José" → "EJ". */
    function iniciais(nome, email) {
        const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);

        if (partes.length >= 2) {
            return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
        }
        if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();

        return String(email || "?").slice(0, 1).toUpperCase();
    }

    /** Endereço público da foto (com versão, para não ficar em cache). */
    function urlDaFoto(caminho, versao) {
        if (!caminho) return null;

        const { data } = client.storage.from(BUCKET).getPublicUrl(caminho);
        const v = versao ? new Date(versao).getTime() : Date.now();

        return `${data.publicUrl}?v=${v}`;
    }

    function revogarPrevia() {
        if (urlPrevia) {
            URL.revokeObjectURL(urlPrevia);
            urlPrevia = null;
        }
    }

    // ---------------------------------------------------------------------
    // Desenhar a foto (cabeçalho e janela)
    // ---------------------------------------------------------------------
    function mostrarImagem(img, ficheiroUrl, textoIniciais, spanIniciais) {
        spanIniciais.textContent = textoIniciais;

        if (ficheiroUrl) {
            img.src = ficheiroUrl;
            img.hidden = false;
            spanIniciais.hidden = true;
        } else {
            img.removeAttribute("src");
            img.hidden = true;
            spanIniciais.hidden = false;
        }
    }

    function desenharCabecalho() {
        const texto = iniciais(perfil.full_name, user?.email);
        const url = urlDaFoto(perfil.avatar_path, perfil.updated_at);

        mostrarImagem(el.headerImg, url, texto, el.headerInitials);
    }

    function desenharJanela() {
        const texto = iniciais(el.nameInput.value || perfil.full_name, user?.email);

        let url = null;
        if (fotoNova && urlPrevia) {
            url = urlPrevia;
        } else if (!removerFoto) {
            url = urlDaFoto(perfil.avatar_path, perfil.updated_at);
        }

        mostrarImagem(el.avatarImg, url, texto, el.avatarInitials);

        el.removeBtn.hidden = !(fotoNova || (perfil.avatar_path && !removerFoto));
    }

    function preencherFormulario() {
        el.nameInput.value = perfil.full_name || user?.user_metadata?.full_name || "";
        el.phoneInput.value = perfil.phone || "";
        el.emailInput.value = user?.email || "";
        desenharJanela();
    }

    // ---------------------------------------------------------------------
    // Carregar o perfil
    // ---------------------------------------------------------------------
    async function carregarPerfil() {
        if (!user) return;

        try {
            const { data, error } = await client
                .from("profiles")
                .select("full_name, phone, avatar_path, updated_at")
                .eq("id", user.id)
                .maybeSingle();

            if (error) throw error;

            perfil = {
                full_name: data?.full_name || user.user_metadata?.full_name || "",
                phone: data?.phone || "",
                avatar_path: data?.avatar_path || null,
                updated_at: data?.updated_at || null
            };
        } catch (error) {
            console.error("Erro ao carregar o perfil:", error);
            perfil = {
                full_name: user.user_metadata?.full_name || "",
                phone: "",
                avatar_path: null,
                updated_at: null
            };
        }

        desenharCabecalho();
    }

    /** Apaga tudo o que é de um cliente (usado ao terminar a sessão). */
    function limparTudo() {
        user = null;
        perfil = { full_name: "", phone: "", avatar_path: null, updated_at: null };
        fotoNova = null;
        removerFoto = false;
        revogarPrevia();

        if (el.dialog.open) el.dialog.close();

        el.form.reset();
        showMessage("");
        mostrarImagem(el.headerImg, null, "", el.headerInitials);
        mostrarImagem(el.avatarImg, null, "", el.avatarInitials);
    }

    // ---------------------------------------------------------------------
    // Reduzir a foto: quadrada, 512 px, JPEG (também retira dados de localização)
    // ---------------------------------------------------------------------
    async function prepararFoto(ficheiro) {
        if (!ficheiro.type.startsWith("image/")) {
            throw erroDeFoto("Escolha um ficheiro de imagem (JPG, PNG ou WebP).");
        }
        if (ficheiro.size > MAX_FICHEIRO_MB * 1024 * 1024) {
            throw erroDeFoto(`A foto é demasiado grande (máximo ${MAX_FICHEIRO_MB} MB).`);
        }

        let imagem;
        try {
            imagem = await createImageBitmap(ficheiro, { imageOrientation: "from-image" });
        } catch {
            throw erroDeFoto("Não foi possível abrir esta imagem. Tente outra.");
        }

        // Corte quadrado ao centro
        const lado = Math.min(imagem.width, imagem.height);
        const origemX = (imagem.width - lado) / 2;
        const origemY = (imagem.height - lado) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = TAMANHO_FOTO;
        canvas.height = TAMANHO_FOTO;

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#0c0c0c"; // fundo para PNG com transparência
        ctx.fillRect(0, 0, TAMANHO_FOTO, TAMANHO_FOTO);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imagem, origemX, origemY, lado, lado, 0, 0, TAMANHO_FOTO, TAMANHO_FOTO);

        if (typeof imagem.close === "function") imagem.close();

        const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", QUALIDADE_JPEG)
        );

        if (!blob) throw erroDeFoto("Não foi possível preparar a foto. Tente outra.");

        return blob;
    }

    // ---------------------------------------------------------------------
    // Guardar
    // ---------------------------------------------------------------------
    function setGuardar(estado) {
        aGuardar = estado;
        el.saveBtn.disabled = estado;
        el.closeBtn.disabled = estado;
        el.removeBtn.disabled = estado;
        el.saveBtn.textContent = estado ? "A guardar..." : TEXTO_GUARDAR;
    }

    function validarCampos() {
        const nome = el.nameInput.value.trim();
        const telefone = el.phoneInput.value.trim();

        if (nome.length < 2) return { erro: "Introduza o seu nome completo." };
        if (nome.length > MAX_NOME) return { erro: `O nome pode ter no máximo ${MAX_NOME} caracteres.` };

        if (telefone) {
            const digitos = telefone.replace(/\D/g, "");

            if (!/^[+\d\s().-]+$/.test(telefone) || digitos.length < 7 || digitos.length > 15) {
                return { erro: "O telefone não parece válido. Exemplo: +244 900 000 000." };
            }
        }

        return { nome, telefone };
    }

    async function guardar(event) {
        event.preventDefault();

        if (aGuardar) return;

        const campos = validarCampos();

        if (campos.erro) {
            showMessage(campos.erro, "error");
            return;
        }

        const semAlteracoes =
            !fotoNova &&
            !removerFoto &&
            campos.nome === (perfil.full_name || "") &&
            campos.telefone === (perfil.phone || "");

        if (semAlteracoes) {
            showMessage("Não fez nenhuma alteração.", "info");
            return;
        }

        setGuardar(true);
        showMessage("");

        try {
            const caminho = `${user.id}/avatar.jpg`;
            let novoCaminho = perfil.avatar_path;

            // 1) Foto
            if (fotoNova) {
                const { error } = await client.storage
                    .from(BUCKET)
                    .upload(caminho, fotoNova, {
                        contentType: "image/jpeg",
                        upsert: true,
                        cacheControl: "3600"
                    });

                if (error) throw error;
                novoCaminho = caminho;
            } else if (removerFoto && perfil.avatar_path) {
                const { error } = await client.storage
                    .from(BUCKET)
                    .remove([perfil.avatar_path]);

                if (error) throw error;
                novoCaminho = null;
            }

            // 2) Dados do perfil
            const agora = new Date().toISOString();

            const { error: erroPerfil } = await client
                .from("profiles")
                .upsert({
                    id: user.id,
                    full_name: campos.nome,
                    phone: campos.telefone || null,
                    avatar_path: novoCaminho,
                    updated_at: agora
                });

            if (erroPerfil) throw erroPerfil;

            // 3) Nome também na conta (para o "Olá, ..." e o WhatsApp)
            if (campos.nome !== (user.user_metadata?.full_name || "")) {
                const { data, error: erroConta } = await client.auth.updateUser({
                    data: { full_name: campos.nome }
                });

                if (erroConta) {
                    console.warn("Aviso ao atualizar o nome na conta:", erroConta);
                } else if (data?.user) {
                    user = data.user;
                }
            }

            perfil = {
                full_name: campos.nome,
                phone: campos.telefone,
                avatar_path: novoCaminho,
                updated_at: agora
            };

            fotoNova = null;
            removerFoto = false;
            revogarPrevia();
            el.photoInput.value = "";

            desenharCabecalho();
            desenharJanela();
            showMessage("Perfil guardado com sucesso.", "success");
        } catch (error) {
            console.error("Erro ao guardar o perfil:", error);
            showMessage(
                mensagemDeErro(error, "Não foi possível guardar o perfil. Tente novamente."),
                "error"
            );
        } finally {
            setGuardar(false);
        }
    }

    // ---------------------------------------------------------------------
    // Janela
    // ---------------------------------------------------------------------
    function abrirJanela() {
        if (!user) return;

        fotoNova = null;
        removerFoto = false;
        revogarPrevia();
        el.photoInput.value = "";
        showMessage("");

        preencherFormulario();

        if (typeof el.dialog.showModal === "function") {
            el.dialog.showModal();
        } else {
            el.dialog.setAttribute("open", "");
        }

        el.nameInput.focus();
    }

    function fecharJanela() {
        if (aGuardar) return;

        revogarPrevia();

        if (typeof el.dialog.close === "function") {
            el.dialog.close();
        } else {
            el.dialog.removeAttribute("open");
        }
    }

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------
    el.openBtn.addEventListener("click", abrirJanela);
    el.closeBtn.addEventListener("click", fecharJanela);
    el.form.addEventListener("submit", guardar);

    // Clicar fora da janela fecha-a
    el.dialog.addEventListener("click", (evento) => {
        if (evento.target === el.dialog) fecharJanela();
    });

    // Não deixa fechar com ESC enquanto está a guardar
    el.dialog.addEventListener("cancel", (evento) => {
        if (aGuardar) evento.preventDefault();
    });

    // As iniciais acompanham o nome que o cliente escreve
    el.nameInput.addEventListener("input", () => {
        if (!el.avatarImg.hidden) return;
        el.avatarInitials.textContent = iniciais(el.nameInput.value, user?.email);
    });

    el.photoInput.addEventListener("change", async () => {
        const ficheiro = el.photoInput.files?.[0];

        if (!ficheiro) return;

        showMessage("A preparar a foto...");

        try {
            const blob = await prepararFoto(ficheiro);

            revogarPrevia();
            urlPrevia = URL.createObjectURL(blob);
            fotoNova = blob;
            removerFoto = false;

            desenharJanela();
            showMessage("Foto pronta. Clique em «Guardar alterações».", "info");
        } catch (error) {
            console.error("Erro ao preparar a foto:", error);
            fotoNova = null;
            showMessage(
                mensagemDeErro(error, "Não foi possível usar esta foto. Tente outra."),
                "error"
            );
        } finally {
            el.photoInput.value = ""; // permite escolher a mesma foto outra vez
        }
    });

    el.removeBtn.addEventListener("click", () => {
        revogarPrevia();
        fotoNova = null;
        removerFoto = true;

        desenharJanela();
        showMessage("A foto será removida quando guardar.", "info");
    });

    // ---------------------------------------------------------------------
    // Arranque: acompanha o início e o fim de sessão
    // ---------------------------------------------------------------------
    (async () => {
        client = await esperarSupabase();

        if (!client) {
            console.error("HAUREA DIGITAL: window.supabaseClient não foi criado (perfil).");
            return;
        }

        try {
            const { data } = await client.auth.getSession();
            user = data.session?.user ?? null;
            if (user) await carregarPerfil();
        } catch (error) {
            console.error("Erro ao verificar a sessão (perfil):", error);
        }

        client.auth.onAuthStateChange((evento, session) => {
            if (evento === "SIGNED_OUT" || !session?.user) {
                limparTudo();
                return;
            }

            const mudouDeUtilizador = user?.id !== session.user.id;
            user = session.user;

            // setTimeout: evita bloquear o Supabase dentro deste evento
            if (mudouDeUtilizador || evento === "SIGNED_IN") {
                setTimeout(carregarPerfil, 0);
            }
        });
    })();
});