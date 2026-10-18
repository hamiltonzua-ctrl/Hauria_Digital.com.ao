/* =========================================================
   HAUREA DIGITAL — animations.js
   Não mexe no Supabase, no login nem nos pedidos.
   Carregar DEPOIS do script.js.
   ========================================================= */
(() => {
    "use strict";

    const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

    /* ---------- 1. Elementos que aparecem ao fazer scroll ---------- */
    const observador =
        "IntersectionObserver" in window && !reduzirMovimento
            ? new IntersectionObserver(
                  (entradas, obs) => {
                      entradas.forEach((entrada) => {
                          if (!entrada.isIntersecting) return;
                          entrada.target.classList.add("is-visible");
                          obs.unobserve(entrada.target);
                      });
                  },
                  { threshold: 0.15, rootMargin: "0px 0px -6% 0px" }
              )
            : null;

    function registarReveal(el) {
        if (el.dataset.hdPronto) return;
        el.dataset.hdPronto = "1";

        const atraso = el.dataset.delay;
        if (atraso) el.style.setProperty("--d", `${atraso}ms`);

        if (observador) {
            observador.observe(el);
        } else {
            el.classList.add("is-visible");
        }
    }

    document.querySelectorAll("[data-reveal]").forEach(registarReveal);

    /* ---------- 2. Progresso do scroll + cabeçalho ---------- */
    const barra = $("#scrollProgress");
    const cabecalho = $(".cabecalho");
    let aAgendar = false;

    function aoFazerScroll() {
        if (aAgendar) return;
        aAgendar = true;

        requestAnimationFrame(() => {
            const maximo = document.documentElement.scrollHeight - window.innerHeight;
            const progresso = maximo > 0 ? window.scrollY / maximo : 0;

            if (barra) barra.style.transform = `scaleX(${progresso})`;
            if (cabecalho) cabecalho.classList.toggle("is-scrolled", window.scrollY > 20);

            aAgendar = false;
        });
    }

    window.addEventListener("scroll", aoFazerScroll, { passive: true });
    aoFazerScroll();

    /* ---------- 3. Brilho dourado que segue o rato nos cartões ---------- */
    if (!reduzirMovimento) {
        document.addEventListener(
            "pointermove",
            (evento) => {
                const cartao = evento.target.closest && evento.target.closest(".servico");
                if (!cartao) return;

                const caixa = cartao.getBoundingClientRect();
                cartao.style.setProperty("--mx", `${evento.clientX - caixa.left}px`);
                cartao.style.setProperty("--my", `${evento.clientY - caixa.top}px`);
            },
            { passive: true }
        );
    }

    /* ---------- 4. Transição suave entre login e site ---------- */
    ["authPage", "appContent"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        const estaVisivel = () => !el.hidden && getComputedStyle(el).display !== "none";
        let eraVisivel = estaVisivel();

        new MutationObserver(() => {
            const agoraVisivel = estaVisivel();

            if (agoraVisivel && !eraVisivel) {
                el.classList.remove("page-enter");
                void el.offsetWidth; // reinicia a animação
                el.classList.add("page-enter");
            }

            eraVisivel = agoraVisivel;
        }).observe(el, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
    });

    /* ---------- 5. Pedidos carregados pelo script.js ---------- */
    const listaPedidos = $("#myRequests");

    if (listaPedidos) {
        new MutationObserver(() => {
            Array.from(listaPedidos.children).forEach((no, indice) => {
                if (no.dataset.hdAnim) return;
                no.dataset.hdAnim = "1";
                no.style.animationDelay = `${indice * 70}ms`;
            });
        }).observe(listaPedidos, { childList: true });
    }

    /* ---------- 6. Fundo animado: partículas douradas discretas ---------- */
    function iniciarParticulas() {
        const canvas = $("#bgCanvas");
        if (!canvas || reduzirMovimento) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Garante que é um fundo fixo, atrás do conteúdo e que não bloqueia cliques
        Object.assign(canvas.style, {
            position: "fixed",
            inset: "0",
            width: "100%",
            height: "100%",
            zIndex: "-1",
            pointerEvents: "none",
        });

        let largura = 0;
        let altura = 0;
        let particulas = [];
        let quadro = 0;

        function ajustarTamanho() {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            largura = window.innerWidth;
            altura = window.innerHeight;

            canvas.width = largura * dpr;
            canvas.height = altura * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function criarParticulas() {
            const limite = largura < 768 ? 28 : 65;
            const total = Math.max(18, Math.min(limite, Math.round((largura * altura) / 24000)));

            particulas = Array.from({ length: total }, () => ({
                x: Math.random() * largura,
                y: Math.random() * altura,
                vx: (Math.random() - 0.5) * 0.25,
                vy: (Math.random() - 0.5) * 0.25,
                r: Math.random() * 1.4 + 0.5,
            }));
        }

        function desenhar() {
            ctx.clearRect(0, 0, largura, altura);

            for (let i = 0; i < particulas.length; i++) {
                const p = particulas[i];

                p.x += p.vx;
                p.y += p.vy;

                // Ressalta nas bordas, sem ficar preso fora do ecrã
                if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
                else if (p.x > largura) { p.x = largura; p.vx = -Math.abs(p.vx); }

                if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
                else if (p.y > altura) { p.y = altura; p.vy = -Math.abs(p.vy); }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(212, 175, 55, 0.75)";
                ctx.fill();

                for (let j = i + 1; j < particulas.length; j++) {
                    const q = particulas[j];
                    const dx = p.x - q.x;
                    const dy = p.y - q.y;
                    const d2 = dx * dx + dy * dy;

                    if (d2 < 12100) {
                        const alfa = (1 - Math.sqrt(d2) / 110) * 0.16;
                        ctx.strokeStyle = `rgba(212, 175, 55, ${alfa})`;
                        ctx.lineWidth = 0.6;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(q.x, q.y);
                        ctx.stroke();
                    }
                }
            }

            quadro = requestAnimationFrame(desenhar);
        }

        function parar() {
            cancelAnimationFrame(quadro);
            quadro = 0;
        }

        function arrancar() {
            if (!quadro) quadro = requestAnimationFrame(desenhar);
        }

        // Poupa bateria: pausa quando o separador não está visível
        document.addEventListener("visibilitychange", () => {
            document.hidden ? parar() : arrancar();
        });

        // No telemóvel a barra do navegador altera a altura ao fazer scroll:
        // só recria as partículas quando a LARGURA muda
        let temporizador;
        window.addEventListener("resize", () => {
            clearTimeout(temporizador);
            temporizador = setTimeout(() => {
                const larguraAnterior = largura;
                ajustarTamanho();
                if (largura !== larguraAnterior) criarParticulas();
            }, 200);
        });

        ajustarTamanho();
        criarParticulas();
        arrancar();
    }

    iniciarParticulas();
})();