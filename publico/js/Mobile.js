/**
 * @fileoverview Utilitarios para suporte mobile do Snakis.
 *
 * Responsavel por adaptar o jogo para dispositivos moveis:
 * - Deteccao confiavel de dispositivo touch (celular/tablet)
 * - Calculo de tamanho de celula responsivo para caber na tela
 * - Controle por swipe na tela inteira (touchmove continuo)
 * - Feedback haptico (vibracao) em eventos do jogo
 * - Gerenciamento de fullscreen para imersao total
 * - Bloqueio de gestos nativos do navegador durante gameplay
 *
 * Este modulo eh carregado antes dos scripts de jogo e disponibiliza
 * o objeto global `Mobile` para uso em JogoSolo e ClienteMultijogador.
 *
 * @namespace Mobile
 */

const Mobile = {

  /* =========================================================================
   * DETECCAO DE DISPOSITIVO
   * ======================================================================= */

  /**
   * Detecta se o dispositivo primario de entrada eh touch (celular/tablet).
   * Usa media queries CSS para deteccao confiavel — evita falsos positivos
   * em laptops com tela touchscreen (que tem hover + pointer fine).
   * @returns {boolean} True se for dispositivo touch primario.
   */
  ehTouch() {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  },

  /* =========================================================================
   * DIMENSIONAMENTO RESPONSIVO DO CANVAS
   * ======================================================================= */

  /**
   * Calcula o tamanho ideal da celula para o canvas caber na tela mobile.
   * Considera o espaco disponivel descontando HUD (topo) e controles (baixo).
   * No desktop, retorna o tamanho padrao definido em CONSTANTES (20px).
   *
   * @param {number} larguraGrid - Colunas do grid.
   * @param {number} alturaGrid - Linhas do grid.
   * @returns {number} Tamanho da celula em pixels logicos.
   */
  calcularTamanhoCelula(larguraGrid, alturaGrid) {
    if (!this.ehTouch()) return CONSTANTES.TABULEIRO.TAMANHO_CELULA;

    // Usar viewport visual (descontando barra do navegador mobile)
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const vw = window.innerWidth;

    // Margens: HUD compacto (~56px) + barra efeitos (~32px) + controles (~190px) + gaps (~16px)
    const margemHorizontal = 12;
    const margemVertical = 56 + 32 + 190 + 16;

    const larguraDisponivel = vw - margemHorizontal;
    const alturaDisponivel = vh - margemVertical;

    const porLargura = larguraDisponivel / larguraGrid;
    const porAltura = alturaDisponivel / alturaGrid;

    // Piso inteiro para alinhar pixels, minimo 8px, maximo o padrao (20px)
    const celula = Math.floor(Math.min(porLargura, porAltura));
    return Math.max(8, Math.min(celula, CONSTANTES.TABULEIRO.TAMANHO_CELULA));
  },

  /* =========================================================================
   * CONTROLE POR SWIPE (TELA INTEIRA)
   * ======================================================================= */

  /**
   * Configura swipe na tela inteira como controle principal no mobile.
   *
   * Diferente de swipes simples (touchstart→touchend), este sistema usa
   * touchmove continuo: o jogador mantem o dedo na tela e muda de direcao
   * arrastando — sem precisar levantar e colocar o dedo novamente.
   * Cada segmento de arrasto >= 25px dispara uma mudanca de direcao.
   *
   * Ignora toques em elementos interativos (botoes, inputs, overlays).
   *
   * @param {function(string):void} callback - Recebe a direcao detectada.
   * @param {function():boolean} estaAtivo - Retorna true se o swipe deve processar.
   * @returns {function} Funcao para remover os listeners (cleanup).
   */
  configurarSwipeGlobal(callback, estaAtivo) {
    let inicioX = 0;
    let inicioY = 0;
    let rastreando = false;
    const DISTANCIA_MINIMA = 25;

    const onTouchStart = (e) => {
      // Nao capturar toques em elementos interativos
      if (e.target.closest('button, input, a, select, .overlay-jogo, .controles-mobile')) return;
      inicioX = e.touches[0].clientX;
      inicioY = e.touches[0].clientY;
      rastreando = true;
    };

    const onTouchMove = (e) => {
      if (!rastreando || !estaAtivo()) return;
      e.preventDefault(); // Previne scroll/pull-to-refresh durante gameplay

      const dx = e.touches[0].clientX - inicioX;
      const dy = e.touches[0].clientY - inicioY;

      if (Math.abs(dx) < DISTANCIA_MINIMA && Math.abs(dy) < DISTANCIA_MINIMA) return;

      // Direcao predominante (horizontal vs vertical)
      if (Math.abs(dx) > Math.abs(dy)) {
        callback(dx > 0 ? 'direita' : 'esquerda');
      } else {
        callback(dy > 0 ? 'baixo' : 'cima');
      }

      // Resetar origem para permitir mudancas continuas de direcao
      inicioX = e.touches[0].clientX;
      inicioY = e.touches[0].clientY;
    };

    const onTouchEnd = () => {
      rastreando = false;
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    // Retorna funcao de cleanup
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  },

  /* =========================================================================
   * FEEDBACK HAPTICO (VIBRACAO)
   * ======================================================================= */

  /**
   * Dispara vibracao no dispositivo (Android via Vibration API).
   * Falha silenciosamente em iOS ou navegadores sem suporte.
   * @param {number|number[]} padrao - Duracao (ms) ou array [vibrar, pausa, vibrar...].
   */
  vibrar(padrao) {
    try {
      if ('vibrate' in navigator) navigator.vibrate(padrao);
    } catch (e) { /* sem suporte - ignorar */ }
  },

  /** Toque sutil ao comer comida normal (15ms) */
  vibrarComer() { this.vibrar(15); },

  /** Duplo toque ao comer comida especial (dourada, vida, escudo, velocidade) */
  vibrarEspecial() { this.vibrar([25, 15, 25]); },

  /** Vibracao forte ao perder vida */
  vibrarMorrer() { this.vibrar([80, 30, 80]); },

  /** Vibracao longa e dramatica ao game over */
  vibrarGameOver() { this.vibrar([100, 50, 100, 50, 150]); },

  /** Toque ao escudo bloquear colisao */
  vibrarEscudo() { this.vibrar([40, 20, 40]); },

  /* =========================================================================
   * FULLSCREEN
   * ======================================================================= */

  /**
   * Tenta entrar em modo fullscreen para imersao total no mobile.
   * Deve ser chamado dentro de um handler de interacao do usuario
   * (click/touchstart) por exigencia dos navegadores.
   * No desktop, nao faz nada.
   */
  async entrarFullscreen() {
    if (!this.ehTouch()) return;
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch (e) { /* navegador nao suporta ou usuario negou */ }
  },

  /* =========================================================================
   * GERENCIAMENTO DE GESTOS DO NAVEGADOR
   * ======================================================================= */

  /**
   * Bloqueia gestos nativos do navegador durante gameplay:
   * scroll, zoom por pinch, pull-to-refresh, selecao de texto.
   * Deve ser chamado ao entrar em modo de jogo.
   */
  bloquearGestos() {
    document.body.style.touchAction = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
  },

  /**
   * Restaura gestos normais do navegador.
   * Deve ser chamado ao sair do jogo (menu, lobby, etc).
   */
  liberarGestos() {
    document.body.style.touchAction = '';
    document.body.style.overscrollBehavior = '';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
  },
};

/* Disponibilizar globalmente */
if (typeof window !== 'undefined') {
  window.Mobile = Mobile;
}
