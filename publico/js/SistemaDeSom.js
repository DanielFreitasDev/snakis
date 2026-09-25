/**
 * @fileoverview Sistema de efeitos sonoros e musica procedural do Snakis.
 *
 * Gera todos os sons em tempo real usando a Web Audio API,
 * sem necessidade de arquivos de audio externos. Sons estilo
 * retro/8-bit com osciladores, sweeps de frequencia e envelopes.
 *
 * A musica ambiente tambem eh 100% procedural: um agendador com
 * lookahead (padrao "tale of two clocks") sorteia notas de uma escala
 * pentatonica menor sobre uma progressao de acordes, com baixo,
 * melodia e percussao leve. A intensidade (andamento + densidade de
 * notas) sobe conforme o jogo esquenta (nivel no solo, arena
 * encolhendo no multiplayer).
 *
 * O AudioContext eh criado/resumido no primeiro gesto do usuario
 * (click/keydown) para respeitar a politica de autoplay dos navegadores.
 *
 * @class SistemaDeSom
 */

/* ===========================================================================
 * MUSICA AMBIENTE PROCEDURAL
 * ======================================================================= */

class MusicaProcedural {
  /**
   * @param {SistemaDeSom} som - Sistema de som dono do AudioContext.
   */
  constructor(som) {
    /** @type {SistemaDeSom} */
    this.som = som;

    /** @type {boolean} Se a musica esta tocando */
    this.ativa = false;

    /** @type {number} Intensidade 0..1 (andamento + densidade de notas) */
    this.intensidade = 0.25;

    /** @type {number} Andamento base em BPM (sobe com a intensidade) */
    this.bpmBase = 106;

    /** @type {number} Passo atual dentro do compasso (16 semicolcheias) */
    this.passo = 0;

    /** @type {number} Indice do acorde atual na progressao */
    this.compasso = 0;

    /** @type {number} Instante (ctx.currentTime) da proxima nota agendada */
    this.proximoTempo = 0;

    /** @type {number|null} setInterval do agendador */
    this.timer = null;

    /** @type {GainNode|null} Ganho master da musica (fade in/out) */
    this.ganho = null;

    /** @type {number} Indice atual do passeio aleatorio da melodia */
    this.indiceMelodia = 4;

    /** @type {string|null} Modo pendente aguardando o AudioContext */
    this.pendente = null;

    /**
     * Temas musicais por modo de jogo. Cada tema define a progressao
     * de acordes do baixo (Hz) e a escala pentatonica da melodia (Hz).
     */
    this.temas = {
      // Solo: La menor pentatonica, clima exploratorio
      solo: {
        baixos: [110.00, 87.31, 130.81, 98.00],            // A2, F2, C3, G2
        escala: [220.00, 261.63, 293.66, 329.63, 392.00,   // A3 C4 D4 E4 G4
                 440.00, 523.25, 587.33, 659.26, 783.99],  // A4 C5 D5 E5 G5
      },
      // Multiplayer: Mi menor pentatonica, clima de arena
      multi: {
        baixos: [82.41, 130.81, 98.00, 146.83],            // E2, C3, G2, D3
        escala: [164.81, 196.00, 220.00, 246.94, 293.66,   // E3 G3 A3 B3 D4
                 329.63, 392.00, 440.00, 493.88, 587.33],  // E4 G4 A4 B4 D5
      },
    };

    /** @type {object} Tema ativo */
    this.tema = this.temas.solo;
  }

  /**
   * Comeca a tocar (ou retoma) a musica ambiente.
   * Se o AudioContext ainda nao existe (nenhum gesto do usuario),
   * guarda o pedido e comeca assim que o audio for liberado.
   * @param {string} [modo] - 'solo' | 'multi'.
   */
  iniciar(modo) {
    const nomeModo = this.temas[modo] ? modo : 'solo';
    this.tema = this.temas[nomeModo];

    if (!this.som.ctx) {
      this.pendente = nomeModo;
      return;
    }
    if (this.ativa) return;

    const ctx = this.som.ctx;
    this.ativa = true;
    this.pendente = null;
    this.passo = 0;
    this.compasso = 0;
    this.indiceMelodia = 4;

    // Ganho master da musica com fade in suave
    this.ganho = ctx.createGain();
    this.ganho.gain.setValueAtTime(0, ctx.currentTime);
    this.ganho.gain.linearRampToValueAtTime(this._volumeAlvo(), ctx.currentTime + 2);
    this.ganho.connect(ctx.destination);

    this.proximoTempo = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._agendar(), 80);
  }

  /**
   * Para a musica com fade out curto e libera os recursos.
   */
  parar() {
    this.pendente = null;
    if (!this.ativa) return;
    this.ativa = false;

    clearInterval(this.timer);
    this.timer = null;

    const ctx = this.som.ctx;
    const ganho = this.ganho;
    this.ganho = null;

    if (ganho && ctx) {
      ganho.gain.cancelScheduledValues(ctx.currentTime);
      ganho.gain.setValueAtTime(ganho.gain.value, ctx.currentTime);
      ganho.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.7);
      setTimeout(() => {
        try { ganho.disconnect(); } catch {}
      }, 900);
    }
  }

  /**
   * Ajusta a intensidade da musica (0 = calma, 1 = frenetica).
   * @param {number} valor - Intensidade desejada.
   */
  definirIntensidade(valor) {
    const v = Number(valor);
    if (Number.isFinite(v)) {
      this.intensidade = Math.max(0, Math.min(1, v));
    }
  }

  /**
   * Volume master alvo da musica, respeitando mudo e preferencia.
   * A musica fica bem abaixo dos efeitos sonoros (ambiente).
   * @returns {number}
   * @private
   */
  _volumeAlvo() {
    if (this.som.mudo || this.som.musicaDesligada) return 0;
    return this.som.volume * 0.9;
  }

  /**
   * Agendador com lookahead: agenda todas as notas que caem na
   * janela dos proximos 200ms, mantendo o relogio musical preciso
   * mesmo com jitter do setInterval.
   * @private
   */
  _agendar() {
    const ctx = this.som.ctx;
    if (!ctx || !this.ganho) return;

    // Acompanhar mute/preferencias em tempo real (ramp suave)
    const alvo = this._volumeAlvo();
    this.ganho.gain.setTargetAtTime(alvo, ctx.currentTime, 0.15);
    const silenciado = alvo === 0;

    while (this.proximoTempo < ctx.currentTime + 0.2) {
      if (!silenciado) {
        this._agendarPasso(this.passo, this.proximoTempo);
      }

      const bpm = this.bpmBase + this.intensidade * 28;
      this.proximoTempo += 60 / bpm / 4; // Semicolcheia
      this.passo = (this.passo + 1) % 16;
      if (this.passo === 0) {
        this.compasso = (this.compasso + 1) % this.tema.baixos.length;
      }
    }
  }

  /**
   * Decide e agenda as vozes de um passo (semicolcheia) do compasso.
   * @param {number} passo - Posicao no compasso (0 a 15).
   * @param {number} tempo - Instante absoluto (ctx.currentTime) da nota.
   * @private
   */
  _agendarPasso(passo, tempo) {
    const raiz = this.tema.baixos[this.compasso];
    const duracaoPasso = 60 / (this.bpmBase + this.intensidade * 28) / 4;

    // --- Baixo: fundacao nos tempos fortes ---
    if (passo === 0) {
      this._nota(raiz, 'triangle', tempo, duracaoPasso * 3.4, 0.30);
    } else if (passo === 8) {
      // Alterna raiz e quinta para dar movimento
      const freq = Math.random() < 0.5 ? raiz : raiz * 1.5;
      this._nota(freq, 'triangle', tempo, duracaoPasso * 3.4, 0.26);
    } else if (passo === 14 && Math.random() < 0.35) {
      // Nota de passagem ocasional (oitava acima)
      this._nota(raiz * 2, 'triangle', tempo, duracaoPasso * 1.6, 0.18);
    }

    // --- Percussao: chimbal de ruido bem discreto ---
    const chimbal = passo % 8 === 4 ||
      (this.intensidade > 0.55 && passo % 4 === 2);
    if (chimbal) {
      this._ruidoCurto(tempo, 0.05, 0.055);
    }

    // "Bumbo" surdo nos tempos fortes quando o jogo esquenta
    if (this.intensidade > 0.45 && (passo === 0 || passo === 8)) {
      this._nota(70, 'sine', tempo, 0.09, 0.32, 40);
    }

    // --- Melodia: passeio aleatorio na pentatonica ---
    if (passo % 2 !== 0) return; // Melodia so em colcheias

    const chance = (passo === 0 ? 0.65 : 0.26) + this.intensidade * 0.4;
    if (Math.random() > chance) return;

    // Passeio aleatorio com passos curtos (soa melodico, nao aleatorio)
    const salto = Math.random() < 0.14
      ? (Math.random() < 0.5 ? -3 : 3)              // Salto ocasional
      : Math.round((Math.random() - 0.5) * 2.4);    // Passo de -1..1
    this.indiceMelodia = Math.max(0, Math.min(
      this.tema.escala.length - 1, this.indiceMelodia + salto));

    const freq = this.tema.escala[this.indiceMelodia];
    const duracao = duracaoPasso * (Math.random() < 0.3 ? 3.2 : 1.7);
    this._nota(freq, 'square', tempo, duracao, 0.13);
  }

  /**
   * Agenda uma nota conectada ao ganho master da musica.
   * @param {number} freq - Frequencia em Hz.
   * @param {string} tipo - Tipo do oscilador.
   * @param {number} inicio - Instante absoluto de inicio.
   * @param {number} duracao - Duracao em segundos.
   * @param {number} vol - Volume relativo da voz (0..1).
   * @param {number} [freqFim] - Frequencia final (sweep opcional).
   * @private
   */
  _nota(freq, tipo, inicio, duracao, vol, freqFim) {
    const ctx = this.som.ctx;
    if (!ctx || !this.ganho) return;

    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();

    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, inicio);
    if (freqFim) {
      osc.frequency.exponentialRampToValueAtTime(freqFim, inicio + duracao);
    }

    // Ataque rapido + decaimento exponencial (envelope 8-bit suave)
    ganho.gain.setValueAtTime(0, inicio);
    ganho.gain.linearRampToValueAtTime(vol, inicio + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.001, inicio + duracao);

    osc.connect(ganho);
    ganho.connect(this.ganho);
    osc.start(inicio);
    osc.stop(inicio + duracao + 0.02);
  }

  /**
   * Agenda um tique curto de ruido branco (chimbal).
   * @param {number} inicio - Instante absoluto de inicio.
   * @param {number} duracao - Duracao em segundos.
   * @param {number} vol - Volume relativo (0..1).
   * @private
   */
  _ruidoCurto(inicio, duracao, vol) {
    const ctx = this.som.ctx;
    if (!ctx || !this.ganho) return;

    const tamanho = Math.max(1, Math.floor(ctx.sampleRate * duracao));
    const buffer = ctx.createBuffer(1, tamanho, ctx.sampleRate);
    const dados = buffer.getChannelData(0);
    for (let i = 0; i < tamanho; i++) {
      dados[i] = Math.random() * 2 - 1;
    }

    const fonte = ctx.createBufferSource();
    fonte.buffer = buffer;

    // Filtro passa-altas deixa o ruido com cara de chimbal
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'highpass';
    filtro.frequency.value = 6000;

    const ganho = ctx.createGain();
    ganho.gain.setValueAtTime(vol, inicio);
    ganho.gain.exponentialRampToValueAtTime(0.001, inicio + duracao);

    fonte.connect(filtro);
    filtro.connect(ganho);
    ganho.connect(this.ganho);
    fonte.start(inicio);
    fonte.stop(inicio + duracao);
  }
}

class SistemaDeSom {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;

    /** @type {boolean} Mudo global */
    this.mudo = false;

    /** @type {number} Volume master (0 a 1) */
    this.volume = 0.25;

    /** @type {boolean} Se o AudioContext ja foi inicializado */
    this._inicializado = false;

    /** @type {boolean} Preferencia do usuario: musica ambiente desligada */
    this.musicaDesligada = false;

    // Restaurar preferencias do localStorage
    try {
      const salvo = localStorage.getItem('snake_som_mudo');
      if (salvo === 'true') this.mudo = true;
      const musicaOff = localStorage.getItem('snake_musica_desligada');
      if (musicaOff === 'true') this.musicaDesligada = true;
    } catch {}

    /** @type {MusicaProcedural} Motor de musica ambiente */
    this.musica = new MusicaProcedural(this);

    // Inicializar no primeiro gesto do usuario
    this._aguardarGesto();
  }

  /* =========================================================================
   * INICIALIZACAO
   * ======================================================================= */

  /**
   * Aguarda um gesto do usuario (click ou tecla) para criar o AudioContext.
   * Navegadores bloqueiam audio antes de interacao do usuario.
   * @private
   */
  _aguardarGesto() {
    const iniciar = () => {
      if (!this._inicializado) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._inicializado = true;
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      document.removeEventListener('click', iniciar);
      document.removeEventListener('keydown', iniciar);
      document.removeEventListener('touchstart', iniciar);

      // Se alguem pediu musica antes do audio ser liberado, tocar agora
      if (this.musica.pendente) {
        this.musica.iniciar(this.musica.pendente);
      }
    };

    document.addEventListener('click', iniciar);
    document.addEventListener('keydown', iniciar);
    document.addEventListener('touchstart', iniciar);
  }

  /* =========================================================================
   * CONTROLE
   * ======================================================================= */

  /**
   * Alterna o estado mudo e salva no localStorage.
   * A musica ambiente tambem respeita o mudo geral.
   * @returns {boolean} Novo estado (true = mudo).
   */
  alternarMudo() {
    this.mudo = !this.mudo;
    try {
      localStorage.setItem('snake_som_mudo', String(this.mudo));
    } catch {}
    return this.mudo;
  }

  /* =========================================================================
   * MUSICA AMBIENTE (API PUBLICA)
   * ======================================================================= */

  /**
   * Comeca a tocar a musica ambiente procedural.
   * @param {string} [modo] - Tema: 'solo' | 'multi'.
   */
  iniciarMusica(modo) {
    this.musica.iniciar(modo);
  }

  /**
   * Para a musica ambiente com fade out.
   */
  pararMusica() {
    this.musica.parar();
  }

  /**
   * Define a intensidade da musica (0 = calma, 1 = frenetica).
   * @param {number} valor
   */
  definirIntensidadeMusica(valor) {
    this.musica.definirIntensidade(valor);
  }

  /**
   * Liga/desliga apenas a musica ambiente (efeitos continuam) e
   * persiste a preferencia.
   * @returns {boolean} Novo estado (true = musica desligada).
   */
  alternarMusica() {
    this.musicaDesligada = !this.musicaDesligada;
    try {
      localStorage.setItem('snake_musica_desligada', String(this.musicaDesligada));
    } catch {}
    return this.musicaDesligada;
  }

  /* =========================================================================
   * PRIMITIVAS DE AUDIO
   * ======================================================================= */

  /**
   * Toca um tom simples com sweep de frequencia e decay de volume.
   * @param {number} freq - Frequencia inicial (Hz).
   * @param {string} tipo - Tipo do oscilador ('sine'|'square'|'sawtooth'|'triangle').
   * @param {number} duracao - Duracao em segundos.
   * @param {number} [freqFim] - Frequencia final (Hz) para sweep.
   * @param {number} [vol] - Volume (0 a 1). Usa this.volume se omitido.
   * @private
   */
  _tocarTom(freq, tipo, duracao, freqFim, vol) {
    if (this.mudo || !this.ctx) return;

    const agora = this.ctx.currentTime;
    const v = (vol !== undefined ? vol : this.volume);

    const osc = this.ctx.createOscillator();
    const ganho = this.ctx.createGain();

    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, agora);
    if (freqFim && freqFim > 0) {
      osc.frequency.exponentialRampToValueAtTime(freqFim, agora + duracao);
    }

    ganho.gain.setValueAtTime(v, agora);
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + duracao);

    osc.connect(ganho);
    ganho.connect(this.ctx.destination);
    osc.start(agora);
    osc.stop(agora + duracao);
  }

  /**
   * Toca uma sequencia de notas com timing.
   * @param {Array<{freq:number, tipo:string, duracao:number, atraso:number, vol?:number}>} notas
   * @private
   */
  _tocarSequencia(notas) {
    if (this.mudo || !this.ctx) return;

    for (const nota of notas) {
      const agora = this.ctx.currentTime + nota.atraso;
      const v = nota.vol !== undefined ? nota.vol : this.volume;

      const osc = this.ctx.createOscillator();
      const ganho = this.ctx.createGain();

      osc.type = nota.tipo;
      osc.frequency.setValueAtTime(nota.freq, agora);

      ganho.gain.setValueAtTime(v, agora);
      ganho.gain.exponentialRampToValueAtTime(0.001, agora + nota.duracao);

      osc.connect(ganho);
      ganho.connect(this.ctx.destination);
      osc.start(agora);
      osc.stop(agora + nota.duracao);
    }
  }

  /**
   * Gera um burst de ruido branco (para explosoes e impactos).
   * @param {number} duracao - Duracao em segundos.
   * @param {number} [vol] - Volume (0 a 1).
   * @private
   */
  _tocarRuido(duracao, vol) {
    if (this.mudo || !this.ctx) return;

    const agora = this.ctx.currentTime;
    const v = vol !== undefined ? vol : this.volume * 0.4;
    const tamanho = Math.floor(this.ctx.sampleRate * duracao);
    const buffer = this.ctx.createBuffer(1, tamanho, this.ctx.sampleRate);
    const dados = buffer.getChannelData(0);

    for (let i = 0; i < tamanho; i++) {
      dados[i] = Math.random() * 2 - 1;
    }

    const fonte = this.ctx.createBufferSource();
    fonte.buffer = buffer;

    const ganho = this.ctx.createGain();
    ganho.gain.setValueAtTime(v, agora);
    ganho.gain.exponentialRampToValueAtTime(0.001, agora + duracao);

    fonte.connect(ganho);
    ganho.connect(this.ctx.destination);
    fonte.start(agora);
    fonte.stop(agora + duracao);
  }

  /* =========================================================================
   * EFEITOS SONOROS DO JOGO
   * ======================================================================= */

  // ---- Comida ----

  /**
   * Som ao comer comida normal: blip curto ascendente.
   */
  comerNormal() {
    this._tocarTom(523, 'square', 0.08, 1047, this.volume * 0.5);
  }

  /**
   * Som ao comer comida dourada: arpejo brilhante ascendente (3 notas).
   */
  comerDourada() {
    this._tocarSequencia([
      { freq: 784, tipo: 'square', duracao: 0.1, atraso: 0, vol: this.volume * 0.45 },
      { freq: 988, tipo: 'square', duracao: 0.1, atraso: 0.07, vol: this.volume * 0.5 },
      { freq: 1319, tipo: 'square', duracao: 0.15, atraso: 0.14, vol: this.volume * 0.55 },
    ]);
  }

  /**
   * Som ao comer velocidade: sweep rapido ascendente (sawtooth).
   */
  comerVelocidade() {
    this._tocarTom(300, 'sawtooth', 0.12, 1800, this.volume * 0.4);
  }

  /**
   * Som ao comer vida extra: chime melodico de duas notas (sine).
   */
  comerVida() {
    this._tocarSequencia([
      { freq: 659, tipo: 'sine', duracao: 0.15, atraso: 0, vol: this.volume * 0.5 },
      { freq: 880, tipo: 'sine', duracao: 0.25, atraso: 0.12, vol: this.volume * 0.55 },
    ]);
  }

  /**
   * Som ao comer escudo: tom metalico com reverb curto (triangle).
   */
  comerEscudo() {
    this._tocarSequencia([
      { freq: 880, tipo: 'triangle', duracao: 0.08, atraso: 0, vol: this.volume * 0.5 },
      { freq: 1100, tipo: 'triangle', duracao: 0.12, atraso: 0.06, vol: this.volume * 0.45 },
      { freq: 1320, tipo: 'triangle', duracao: 0.18, atraso: 0.12, vol: this.volume * 0.4 },
    ]);
  }

  /**
   * Som ao comer a caveira: acorde grave e dissonante descendo (sinistro).
   */
  comerCaveira() {
    this._tocarSequencia([
      { freq: 311, tipo: 'sawtooth', duracao: 0.25, atraso: 0, vol: this.volume * 0.4 },
      { freq: 220, tipo: 'sawtooth', duracao: 0.3, atraso: 0.12, vol: this.volume * 0.45 },
      { freq: 147, tipo: 'square', duracao: 0.45, atraso: 0.24, vol: this.volume * 0.4 },
    ]);
  }

  // ---- Colisao e Morte ----

  /**
   * Som de colisao/morte: sweep descendente com ruido.
   */
  morrer() {
    this._tocarTom(440, 'square', 0.3, 55, this.volume * 0.5);
    this._tocarRuido(0.2, this.volume * 0.25);
  }

  /**
   * Som de game over: frase triste descendente (4 notas).
   */
  gameOver() {
    this._tocarSequencia([
      { freq: 392, tipo: 'square', duracao: 0.2, atraso: 0, vol: this.volume * 0.45 },
      { freq: 330, tipo: 'square', duracao: 0.2, atraso: 0.2, vol: this.volume * 0.4 },
      { freq: 277, tipo: 'square', duracao: 0.2, atraso: 0.4, vol: this.volume * 0.35 },
      { freq: 220, tipo: 'square', duracao: 0.4, atraso: 0.6, vol: this.volume * 0.3 },
    ]);
    this._tocarRuido(0.15, this.volume * 0.15);
  }

  /**
   * Som de escudo bloqueando colisao: ding metalico deflector.
   */
  escudoBloqueou() {
    this._tocarTom(1500, 'triangle', 0.12, 2200, this.volume * 0.5);
    this._tocarTom(1800, 'sine', 0.08, 2500, this.volume * 0.3);
  }

  // ---- Respawn e Inicio ----

  /**
   * Som de respawn: arpejo rapido ascendente (power-up).
   */
  respawnar() {
    this._tocarSequencia([
      { freq: 330, tipo: 'square', duracao: 0.08, atraso: 0, vol: this.volume * 0.4 },
      { freq: 440, tipo: 'square', duracao: 0.08, atraso: 0.06, vol: this.volume * 0.45 },
      { freq: 554, tipo: 'square', duracao: 0.08, atraso: 0.12, vol: this.volume * 0.5 },
      { freq: 659, tipo: 'square', duracao: 0.12, atraso: 0.18, vol: this.volume * 0.55 },
    ]);
  }

  /**
   * Som de inicio de jogo: fanfarra animada ascendente.
   */
  iniciarJogo() {
    this._tocarSequencia([
      { freq: 523, tipo: 'square', duracao: 0.1, atraso: 0, vol: this.volume * 0.4 },
      { freq: 659, tipo: 'square', duracao: 0.1, atraso: 0.1, vol: this.volume * 0.45 },
      { freq: 784, tipo: 'square', duracao: 0.1, atraso: 0.2, vol: this.volume * 0.5 },
      { freq: 1047, tipo: 'square', duracao: 0.2, atraso: 0.3, vol: this.volume * 0.55 },
    ]);
  }

  /**
   * Som de novo recorde: fanfarra triunfal com harmonias.
   */
  novoRecorde() {
    this._tocarSequencia([
      { freq: 523, tipo: 'square', duracao: 0.12, atraso: 0, vol: this.volume * 0.4 },
      { freq: 659, tipo: 'square', duracao: 0.12, atraso: 0.1, vol: this.volume * 0.45 },
      { freq: 784, tipo: 'square', duracao: 0.12, atraso: 0.2, vol: this.volume * 0.5 },
      { freq: 1047, tipo: 'square', duracao: 0.15, atraso: 0.3, vol: this.volume * 0.5 },
      { freq: 784, tipo: 'square', duracao: 0.1, atraso: 0.45, vol: this.volume * 0.45 },
      { freq: 1047, tipo: 'square', duracao: 0.3, atraso: 0.55, vol: this.volume * 0.55 },
    ]);
    // Harmonia em oitava paralela
    this._tocarSequencia([
      { freq: 1047, tipo: 'sine', duracao: 0.15, atraso: 0.3, vol: this.volume * 0.2 },
      { freq: 1568, tipo: 'sine', duracao: 0.1, atraso: 0.45, vol: this.volume * 0.15 },
      { freq: 2093, tipo: 'sine', duracao: 0.3, atraso: 0.55, vol: this.volume * 0.2 },
    ]);
  }

  /**
   * Som de subir de nivel no modo solo: dois blips ascendentes rapidos.
   */
  nivelSubiu() {
    this._tocarSequencia([
      { freq: 880, tipo: 'square', duracao: 0.08, atraso: 0, vol: this.volume * 0.4 },
      { freq: 1175, tipo: 'square', duracao: 0.14, atraso: 0.08, vol: this.volume * 0.5 },
    ]);
  }

  /**
   * Tick da contagem regressiva pre-partida (3, 2, 1).
   */
  contagemTick() {
    this._tocarTom(440, 'square', 0.1, undefined, this.volume * 0.4);
  }

  /**
   * Som de "VAI!" ao fim da contagem regressiva.
   */
  contagemVai() {
    this._tocarTom(880, 'square', 0.25, 1175, this.volume * 0.5);
  }

  // ---- Multiplayer ----

  /**
   * Som de eliminacao no multiplayer: impacto forte.
   */
  eliminacao() {
    this._tocarTom(200, 'sawtooth', 0.15, 60, this.volume * 0.45);
    this._tocarRuido(0.12, this.volume * 0.3);
  }

  /**
   * Som de segmento removido: hit rapido.
   */
  segmentoRemovido() {
    this._tocarTom(300, 'square', 0.08, 100, this.volume * 0.35);
  }

  /**
   * Som de alerta: arena encolhendo (sirene curta).
   */
  arenaEncolhendo() {
    this._tocarSequencia([
      { freq: 600, tipo: 'sawtooth', duracao: 0.15, atraso: 0, vol: this.volume * 0.3 },
      { freq: 800, tipo: 'sawtooth', duracao: 0.15, atraso: 0.15, vol: this.volume * 0.35 },
      { freq: 600, tipo: 'sawtooth', duracao: 0.15, atraso: 0.3, vol: this.volume * 0.3 },
      { freq: 800, tipo: 'sawtooth', duracao: 0.15, atraso: 0.45, vol: this.volume * 0.35 },
    ]);
  }

  /**
   * Som de partida finalizada no multiplayer: resultado.
   */
  partidaFinalizada() {
    this._tocarSequencia([
      { freq: 523, tipo: 'square', duracao: 0.15, atraso: 0, vol: this.volume * 0.4 },
      { freq: 659, tipo: 'square', duracao: 0.15, atraso: 0.15, vol: this.volume * 0.45 },
      { freq: 784, tipo: 'square', duracao: 0.15, atraso: 0.3, vol: this.volume * 0.5 },
      { freq: 1047, tipo: 'square', duracao: 0.4, atraso: 0.45, vol: this.volume * 0.55 },
    ]);
  }
}

/* =========================================================================
 * INSTANCIA GLOBAL
 * Singleton acessivel por JogoSolo e ClienteMultijogador.
 * ======================================================================= */
window.som = new SistemaDeSom();
