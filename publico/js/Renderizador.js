/**
 * @fileoverview Renderizador do jogo Snake para HTML5 Canvas.
 *
 * Responsavel por toda a parte visual do jogo: grid, cobras (com
 * gradientes, olhos e efeitos), comidas (com animacoes de pulso),
 * coroa do rei, apelidos e HUD. Funciona tanto no modo solo
 * quanto no multiplayer.
 *
 * Padrao utilizado: Strategy Pattern - o renderizador encapsula
 * os algoritmos de desenho, podendo ser configurado para diferentes
 * modos (solo/multi) sem alterar a logica do jogo.
 *
 * @class Renderizador
 */

class Renderizador {
  /**
   * Inicializa o renderizador vinculado a um canvas.
   * @param {HTMLCanvasElement} canvas - Elemento canvas do DOM.
   * @param {number} larguraGrid - Quantidade de colunas do grid.
   * @param {number} alturaGrid - Quantidade de linhas do grid.
   */
  constructor(canvas, larguraGrid, alturaGrid) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');

    /** @type {number} Colunas do grid */
    this.larguraGrid = larguraGrid;

    /** @type {number} Linhas do grid */
    this.alturaGrid = alturaGrid;

    /** @type {number} Tamanho de cada celula em pixels */
    this.tamanhoCelula = CONSTANTES.TABULEIRO.TAMANHO_CELULA;

    // Definir dimensoes do canvas baseado no grid
    this.canvas.width = larguraGrid * this.tamanhoCelula;
    this.canvas.height = alturaGrid * this.tamanhoCelula;

    /** @type {number} Tick para animacoes baseadas em tempo */
    this.tickAnimacao = 0;

    /** @type {number} Angulo da coroa (rotacao continua) */
    this.anguloCoroa = 0;
  }

  /* =========================================================================
   * LIMPEZA E FUNDO
   * ======================================================================= */

  /**
   * Limpa o canvas e desenha o fundo com grade sutil.
   * O fundo usa um gradiente radial escuro com linhas de grade
   * semi-transparentes para orientacao visual.
   */
  desenharFundo() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Fundo com gradiente radial
    const gradiente = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    gradiente.addColorStop(0, '#0f1028');
    gradiente.addColorStop(1, '#080818');
    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, w, h);

    // Linhas da grade
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.larguraGrid; x++) {
      const px = x * this.tamanhoCelula;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }

    for (let y = 0; y <= this.alturaGrid; y++) {
      const py = y * this.tamanhoCelula;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Borda interna sutil
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  /* =========================================================================
   * RENDERIZACAO DE COBRAS
   * ======================================================================= */

  /**
   * Desenha uma cobra completa: corpo com gradiente, cabeca com olhos,
   * e efeitos visuais (escudo, invulnerabilidade, velocidade).
   *
   * @param {Array<{x:number, y:number}>} segmentos - Posicoes dos segmentos no grid.
   * @param {string} corPrincipal - Cor primaria da cobra (hex).
   * @param {string} corSecundaria - Cor secundaria para gradiente.
   * @param {string} direcao - Direcao da cabeca ('cima'|'baixo'|'esquerda'|'direita').
   * @param {object} [opcoes={}] - Opcoes adicionais de renderizacao.
   * @param {boolean} [opcoes.escudo] - Se o escudo esta ativo.
   * @param {boolean} [opcoes.invulneravel] - Se esta invulneravel (pisca).
   * @param {boolean} [opcoes.velocidade] - Se o boost de velocidade esta ativo.
   * @param {boolean} [opcoes.ehRei] - Se esta cobra eh a maior (exibir coroa).
   * @param {string} [opcoes.apelido] - Nickname para exibir acima da cabeca.
   */
  desenharCobra(segmentos, corPrincipal, corSecundaria, direcao, opcoes = {}) {
    if (!segmentos || segmentos.length === 0) return;

    const ctx = this.ctx;
    const tam = this.tamanhoCelula;

    // Efeito de piscar se invulneravel
    if (opcoes.invulneravel && Math.floor(this.tickAnimacao / 5) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    // Desenhar cada segmento do corpo (de tras para frente)
    for (let i = segmentos.length - 1; i >= 0; i--) {
      const seg = segmentos[i];
      const x = seg.x * tam;
      const y = seg.y * tam;
      const ehCabeca = i === 0;

      // Calcular tamanho do segmento (cabeca eh ligeiramente maior)
      const margem = ehCabeca ? 1 : 2;
      const tamanhoSeg = tam - margem * 2;

      // Gradiente do corpo: mais claro na cabeca, mais escuro na cauda
      const fator = 1 - (i / Math.max(segmentos.length, 1)) * 0.4;
      const cor = this._interpolarCor(corSecundaria, corPrincipal, fator);

      // Sombra/brilho neon
      ctx.shadowColor = corPrincipal;
      ctx.shadowBlur = ehCabeca ? 12 : 6;

      // Desenhar segmento arredondado
      ctx.fillStyle = cor;
      this._desenharRetanguloArredondado(
        x + margem, y + margem,
        tamanhoSeg, tamanhoSeg,
        ehCabeca ? 6 : 4
      );
      ctx.fill();

      // Brilho interno no segmento
      const brilhoGrad = ctx.createRadialGradient(
        x + tam / 2, y + tam / 2, 0,
        x + tam / 2, y + tam / 2, tamanhoSeg / 2
      );
      brilhoGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
      brilhoGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = brilhoGrad;
      ctx.fill();

      ctx.shadowBlur = 0;

      // Desenhar olhos na cabeca
      if (ehCabeca) {
        this._desenharOlhos(x, y, tam, direcao);
      }
    }

    // Efeito de escudo (contorno ciano brilhante)
    if (opcoes.escudo) {
      this._desenharEfeitoEscudo(segmentos, tam);
    }

    // Efeito de velocidade (linhas de movimento)
    if (opcoes.velocidade) {
      this._desenharEfeitoVelocidade(segmentos, tam, direcao);
    }

    // Coroa do rei
    if (opcoes.ehRei && segmentos.length > 0) {
      const cabeca = segmentos[0];
      this._desenharCoroa(cabeca.x * tam + tam / 2, cabeca.y * tam - 4);
    }

    // Apelido acima da cobra
    if (opcoes.apelido && segmentos.length > 0) {
      const cabeca = segmentos[0];
      const yOffset = opcoes.ehRei ? -22 : -10;
      this._desenharApelido(
        opcoes.apelido,
        cabeca.x * tam + tam / 2,
        cabeca.y * tam + yOffset,
        corPrincipal
      );
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Desenha os olhos da cobra na direcao correta.
   * Os olhos sao dois circulos brancos com pupilas pretas.
   * @param {number} x - Posicao X da celula em pixels.
   * @param {number} y - Posicao Y da celula em pixels.
   * @param {number} tam - Tamanho da celula.
   * @param {string} direcao - Direcao que a cobra esta olhando.
   * @private
   */
  _desenharOlhos(x, y, tam, direcao) {
    const ctx = this.ctx;
    const centro = tam / 2;
    const raioOlho = 3;
    const raioPupila = 1.5;

    // Posicoes dos olhos baseadas na direcao
    let olho1, olho2;
    const offset = 5;
    const lateral = 4;

    switch (direcao) {
      case 'direita':
        olho1 = { x: x + centro + offset, y: y + centro - lateral };
        olho2 = { x: x + centro + offset, y: y + centro + lateral };
        break;
      case 'esquerda':
        olho1 = { x: x + centro - offset, y: y + centro - lateral };
        olho2 = { x: x + centro - offset, y: y + centro + lateral };
        break;
      case 'cima':
        olho1 = { x: x + centro - lateral, y: y + centro - offset };
        olho2 = { x: x + centro + lateral, y: y + centro - offset };
        break;
      case 'baixo':
        olho1 = { x: x + centro - lateral, y: y + centro + offset };
        olho2 = { x: x + centro + lateral, y: y + centro + offset };
        break;
      default:
        olho1 = { x: x + centro + offset, y: y + centro - lateral };
        olho2 = { x: x + centro + offset, y: y + centro + lateral };
    }

    // Desenhar olhos (parte branca)
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(olho1.x, olho1.y, raioOlho, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(olho2.x, olho2.y, raioOlho, 0, Math.PI * 2);
    ctx.fill();

    // Pupilas (pretas)
    ctx.fillStyle = '#0a0a1e';
    ctx.beginPath();
    ctx.arc(olho1.x, olho1.y, raioPupila, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(olho2.x, olho2.y, raioPupila, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Desenha o contorno brilhante do escudo ao redor da cobra.
   * @param {Array} segmentos - Segmentos da cobra.
   * @param {number} tam - Tamanho da celula.
   * @private
   */
  _desenharEfeitoEscudo(segmentos, tam) {
    const ctx = this.ctx;
    const pulso = 0.5 + Math.sin(this.tickAnimacao * 0.15) * 0.3;

    ctx.strokeStyle = `rgba(0, 255, 255, ${pulso})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 10;

    for (const seg of segmentos) {
      ctx.beginPath();
      this._desenharRetanguloArredondado(
        seg.x * tam - 1, seg.y * tam - 1,
        tam + 2, tam + 2, 6
      );
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
  }

  /**
   * Desenha linhas de velocidade atras da cobra.
   * @param {Array} segmentos - Segmentos da cobra.
   * @param {number} tam - Tamanho da celula.
   * @param {string} direcao - Direcao do movimento.
   * @private
   */
  _desenharEfeitoVelocidade(segmentos, tam, direcao) {
    if (segmentos.length === 0) return;

    const ctx = this.ctx;
    const cauda = segmentos[segmentos.length - 1];
    const cx = cauda.x * tam + tam / 2;
    const cy = cauda.y * tam + tam / 2;

    // Direcao oposta ao movimento para as linhas
    const vetores = {
      direita:  { x: -1, y: 0 },
      esquerda: { x: 1,  y: 0 },
      cima:     { x: 0,  y: 1 },
      baixo:    { x: 0,  y: -1 },
    };
    const v = vetores[direcao] || vetores.direita;

    ctx.strokeStyle = 'rgba(255, 238, 0, 0.4)';
    ctx.lineWidth = 1.5;

    for (let i = 0; i < 3; i++) {
      const offsetPerp = (i - 1) * 6;
      const comprimento = 8 + Math.random() * 12;

      const startX = cx + (v.y * offsetPerp);
      const startY = cy + (v.x * offsetPerp);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + v.x * comprimento, startY + v.y * comprimento);
      ctx.stroke();
    }
  }

  /**
   * Desenha a coroa dourada rotativa acima da cabeca do rei.
   * A coroa eh desenhada proceduralmente com formas geometricas.
   * @param {number} cx - Centro X em pixels.
   * @param {number} cy - Centro Y em pixels.
   * @private
   */
  _desenharCoroa(cx, cy) {
    const ctx = this.ctx;

    // Rotacao continua da coroa
    this.anguloCoroa += 0.03;
    const balanco = Math.sin(this.anguloCoroa) * 3;

    ctx.save();
    ctx.translate(cx + balanco, cy);

    // Sombra dourada
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 8;

    // Corpo da coroa
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.lineTo(-8, -3);
    ctx.lineTo(-5, -1);
    ctx.lineTo(-2, -7);
    ctx.lineTo(0, -2);
    ctx.lineTo(2, -7);
    ctx.lineTo(5, -1);
    ctx.lineTo(8, -3);
    ctx.lineTo(8, 2);
    ctx.closePath();
    ctx.fill();

    // Joia central (vermelha)
    ctx.fillStyle = '#ff4444';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, -1, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Desenha o apelido (nickname) acima da cabeca da cobra.
   * @param {string} apelido - Texto do nickname.
   * @param {number} x - Posicao X central em pixels.
   * @param {number} y - Posicao Y em pixels.
   * @param {string} cor - Cor do texto.
   * @private
   */
  _desenharApelido(apelido, x, y, cor) {
    const ctx = this.ctx;
    ctx.save();

    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Sombra para legibilidade
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = cor;
    ctx.fillText(apelido, x, y);

    ctx.restore();
  }

  /* =========================================================================
   * RENDERIZACAO DE COMIDA
   * ======================================================================= */

  /**
   * Desenha uma comida no mapa com efeito de pulso e brilho.
   * Cada tipo de comida tem visual distinto.
   *
   * @param {{x:number, y:number}} posicao - Posicao no grid.
   * @param {string} tipo - Tipo da comida ('normal'|'velocidade'|'dourada'|'vida'|'escudo').
   * @param {string} cor - Cor da comida.
   * @param {string} brilho - Cor do brilho/shadow.
   */
  desenharComida(posicao, tipo, cor, brilho) {
    const ctx = this.ctx;
    const tam = this.tamanhoCelula;
    const cx = posicao.x * tam + tam / 2;
    const cy = posicao.y * tam + tam / 2;

    // Emojis por tipo de comida
    const emojis = {
      normal: '🍎',
      velocidade: '⚡',
      dourada: '⭐',
      vida: '❤️',
      escudo: '🛡️',
    };

    const emoji = emojis[tipo] || '🍎';

    // Animacao de pulso
    const pulso = 1 + Math.sin(this.tickAnimacao * 0.08 + posicao.x + posicao.y) * 0.15;
    const tamanhoFonte = Math.floor(tam * 0.75 * pulso);

    // Brilho externo sutil
    ctx.shadowColor = cor;
    ctx.shadowBlur = 10;

    ctx.font = `${tamanhoFonte}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, cx, cy);

    ctx.shadowBlur = 0;
  }

  /* =========================================================================
   * ENCOLHIMENTO DA ARENA
   * ======================================================================= */

  /**
   * Desenha a zona de perigo (area fora da arena ativa) com overlay,
   * listras diagonais animadas e borda brilhante.
   * @param {number} bordaArena - Celulas de margem em cada lado.
   * @param {boolean} encolhendo - Se a arena esta em processo de encolhimento.
   */
  desenharBordaArena(bordaArena, encolhendo) {
    if (bordaArena <= 0) return;

    const ctx = this.ctx;
    const tam = this.tamanhoCelula;
    const b = bordaArena * tam;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clip para a zona de perigo (borda ao redor da area jogavel)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.moveTo(b, b); ctx.lineTo(b, h - b); ctx.lineTo(w - b, h - b); ctx.lineTo(w - b, b); ctx.closePath();
    ctx.clip('evenodd');

    // Overlay vermelho escuro
    ctx.fillStyle = encolhendo ? 'rgba(180, 15, 15, 0.45)' : 'rgba(150, 15, 15, 0.3)';
    ctx.fillRect(0, 0, w, h);

    // Listras diagonais de aviso
    ctx.strokeStyle = encolhendo ? 'rgba(255, 40, 40, 0.2)' : 'rgba(255, 40, 40, 0.1)';
    ctx.lineWidth = 4;
    const step = tam * 1.5;
    const offset = encolhendo ? (this.tickAnimacao * 2) % step : 0;
    for (let i = -h + offset; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }

    ctx.restore();

    // Linha de borda brilhante
    const pulso = encolhendo ? 0.5 + Math.sin(this.tickAnimacao * 0.3) * 0.5 : 0.6;
    ctx.strokeStyle = `rgba(255, 50, 50, ${pulso})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff3333';
    ctx.shadowBlur = encolhendo ? 20 : 10;
    ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    ctx.shadowBlur = 0;
  }

  /**
   * Desenha o aviso central pulsante "ARENA ENCOLHENDO!" durante a pausa.
   */
  desenharAvisoEncolhimento() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Overlay escuro
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, w, h);

    // Texto pulsante
    ctx.save();
    const pulso = 0.7 + Math.sin(this.tickAnimacao * 0.2) * 0.3;
    ctx.globalAlpha = pulso;
    ctx.font = 'bold 32px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#ff4444';
    ctx.fillText('ARENA ENCOLHENDO!', w / 2, h / 2);
    ctx.restore();
  }

  /* =========================================================================
   * UTILITARIOS DE DESENHO
   * ======================================================================= */

  /**
   * Desenha um retangulo com cantos arredondados (beginPath + rect arredondado).
   * @param {number} x - Posicao X.
   * @param {number} y - Posicao Y.
   * @param {number} largura - Largura.
   * @param {number} altura - Altura.
   * @param {number} raio - Raio dos cantos.
   * @private
   */
  _desenharRetanguloArredondado(x, y, largura, altura, raio) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + raio, y);
    ctx.lineTo(x + largura - raio, y);
    ctx.quadraticCurveTo(x + largura, y, x + largura, y + raio);
    ctx.lineTo(x + largura, y + altura - raio);
    ctx.quadraticCurveTo(x + largura, y + altura, x + largura - raio, y + altura);
    ctx.lineTo(x + raio, y + altura);
    ctx.quadraticCurveTo(x, y + altura, x, y + altura - raio);
    ctx.lineTo(x, y + raio);
    ctx.quadraticCurveTo(x, y, x + raio, y);
    ctx.closePath();
  }

  /**
   * Interpola entre duas cores hexadecimais.
   * Usado para criar gradientes suaves ao longo do corpo da cobra.
   * @param {string} cor1 - Cor inicial (hex).
   * @param {string} cor2 - Cor final (hex).
   * @param {number} fator - Fator de interpolacao (0 a 1).
   * @returns {string} Cor resultante em formato hex.
   * @private
   */
  _interpolarCor(cor1, cor2, fator) {
    const r1 = parseInt(cor1.slice(1, 3), 16);
    const g1 = parseInt(cor1.slice(3, 5), 16);
    const b1 = parseInt(cor1.slice(5, 7), 16);
    const r2 = parseInt(cor2.slice(1, 3), 16);
    const g2 = parseInt(cor2.slice(3, 5), 16);
    const b2 = parseInt(cor2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * fator);
    const g = Math.round(g1 + (g2 - g1) * fator);
    const b = Math.round(b1 + (b2 - b1) * fator);

    return `rgb(${r},${g},${b})`;
  }

  /**
   * Incrementa o tick de animacao. Deve ser chamado a cada frame.
   */
  atualizarAnimacao() {
    this.tickAnimacao++;
  }
}

/* Disponibilizar globalmente */
if (typeof window !== 'undefined') {
  window.Renderizador = Renderizador;
}
