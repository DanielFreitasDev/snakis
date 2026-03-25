/**
 * @fileoverview Inteligencia Artificial dos bots para o modo multiplayer.
 *
 * Algoritmos utilizados por nivel:
 * - Facil: Manhattan distance, look-ahead 1 passo, sem ataque
 * - Normal: BFS pathfinding, flood fill, ataque moderado, perseguicao de cauda
 * - Dificil: BFS completo, flood fill, ataque agressivo, reducao de territorio,
 *   interceptacao de comida, previsao de movimento, priorizacao contextual de comida
 *
 * Tecnicas baseadas em competicoes de Battlesnake e jogos estilo Slither.io:
 * - BFS (Breadth-First Search): caminho real ate comida/alvos considerando obstaculos
 * - Flood Fill: contagem de espaco acessivel para evitar becos sem saida
 * - Reducao de territorio: mover-se para cortar espaco do oponente (cut-off)
 * - Perseguicao de cauda: quando encurralado, buscar a propria cauda como rota ciclica
 * - Confronto inteligente: atacar quando maior, fugir quando menor, respeitar escudos
 * - Interceptacao: roubar comida que oponente busca chegando antes
 */

const CONSTANTES = require('../publico/js/constantes');

/** Nomes aleatorios e divertidos para os bots */
const NOMES_BOTS = [
  'BotNaldo', 'CobriaNinja', 'ZigZague', 'Robonaldo',
  'SerpentIA', 'AnaCondIA', 'BotElho', 'Jararabot',
  'SucuriBot', 'CobrinhaIA', 'ViboRobo', 'NajaRobo',
  'BotBecue', 'BoaBot', 'Python Jr', 'Fofossauro',
  'TrouxaBot', 'RoboCobra', 'Cobra Cega', 'Bot do Mal',
  'Cobra Maluca', 'SnakeBot Jr', 'Cobrao IA', 'Botossauro',
];

/**
 * Configuracoes de cada nivel de dificuldade.
 *
 * pesoComida         — quanto o bot prioriza buscar comida
 * pesoAtaque         — quanto o bot prioriza atacar/interagir com outras cobras
 * pesoSeguranca      — quanto o bot penaliza proximidade de paredes e becos
 * pesoEspaco         — quanto o bot valoriza manter espaco acessivel (flood fill)
 * chanceErro         — probabilidade de escolher direcao aleatoria
 * usarBFS            — usar BFS (caminho real) em vez de Manhattan distance
 * usarFloodFill      — usar flood fill para avaliar espaco acessivel
 * perseguirCauda     — perseguir propria cauda quando encurralado
 * comidaInteligente  — priorizar comida por tipo e contexto
 * reducaoEspaco      — tentar reduzir espaco do oponente (cut-off)
 * interceptar        — roubar comida que oponente busca
 * preverMovimento    — prever proxima posicao do oponente
 */
const DIFICULDADES = {
  facil: {
    pesoComida: 1.0,
    pesoAtaque: 0.0,
    pesoSeguranca: 0.5,
    pesoEspaco: 0.0,
    chanceErro: 0.18,
    usarBFS: false,
    usarFloodFill: false,
    perseguirCauda: false,
    comidaInteligente: false,
    reducaoEspaco: false,
    interceptar: false,
    preverMovimento: false,
  },
  normal: {
    pesoComida: 0.8,
    pesoAtaque: 0.4,
    pesoSeguranca: 1.0,
    pesoEspaco: 0.8,
    chanceErro: 0.04,
    usarBFS: true,
    usarFloodFill: true,
    perseguirCauda: true,
    comidaInteligente: false,
    reducaoEspaco: false,
    interceptar: false,
    preverMovimento: false,
  },
  dificil: {
    pesoComida: 0.6,
    pesoAtaque: 1.0,
    pesoSeguranca: 1.2,
    pesoEspaco: 1.0,
    chanceErro: 0.0,
    usarBFS: true,
    usarFloodFill: true,
    perseguirCauda: true,
    comidaInteligente: true,
    reducaoEspaco: true,
    interceptar: true,
    preverMovimento: true,
  },
};

const TODAS_DIRECOES = ['cima', 'baixo', 'esquerda', 'direita'];

/** Vetores de vizinhanca para BFS/flood fill */
const VIZINHOS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

class BotIA {
  /**
   * Sorteia um nome divertido que ainda nao esteja em uso na sala.
   * @param {string[]} nomesUsados - Nomes ja utilizados na sala.
   * @returns {string}
   */
  static sortearNome(nomesUsados) {
    const disponiveis = NOMES_BOTS.filter(n => !nomesUsados.includes(n));
    if (disponiveis.length === 0) {
      return `Bot #${Math.floor(Math.random() * 999)}`;
    }
    return disponiveis[Math.floor(Math.random() * disponiveis.length)];
  }

  /* =========================================================================
   * ALGORITMOS AUXILIARES
   * ======================================================================= */

  /**
   * Constroi um Set com chaves numericas (y * largura + x) de todas as
   * celulas ocupadas por cobras vivas. Chaves numericas sao mais rapidas
   * que strings para operacoes de Set.
   */
  static _construirObstaculos(todosJogadores, largura) {
    const obstaculos = new Set();
    for (const j of todosJogadores) {
      if (!j.vivo || j.cobra.length === 0) continue;
      for (let i = 0; i < j.cobra.length; i++) {
        obstaculos.add(j.cobra[i].y * largura + j.cobra[i].x);
      }
    }
    return obstaculos;
  }

  /**
   * BFS da origem ate o alvo mais proximo do array.
   * Retorna distancia real (contornando obstaculos) ou Infinity se inacessivel.
   * Usa fila plana [x, y, dist, x, y, dist, ...] para performance.
   */
  static _bfs(origem, alvos, obstaculos, largura, altura, bordaArena) {
    if (alvos.length === 0) return Infinity;

    const alvoSet = new Set();
    for (let i = 0; i < alvos.length; i++) {
      alvoSet.add(alvos[i].y * largura + alvos[i].x);
    }

    const chaveOrigem = origem.y * largura + origem.x;
    if (alvoSet.has(chaveOrigem)) return 0;

    const visitado = new Set([chaveOrigem]);
    const fila = [origem.x, origem.y, 0];
    let inicio = 0;

    while (inicio < fila.length) {
      const ax = fila[inicio++];
      const ay = fila[inicio++];
      const ad = fila[inicio++];

      for (let v = 0; v < 4; v++) {
        const nx = ax + VIZINHOS[v][0];
        const ny = ay + VIZINHOS[v][1];

        if (nx < bordaArena || nx >= largura - bordaArena ||
            ny < bordaArena || ny >= altura - bordaArena) continue;

        const chave = ny * largura + nx;
        if (visitado.has(chave) || obstaculos.has(chave)) continue;

        if (alvoSet.has(chave)) return ad + 1;

        visitado.add(chave);
        fila.push(nx, ny, ad + 1);
      }
    }
    return Infinity;
  }

  /**
   * BFS completo: retorna Map<chaveNumerica, distancia> de TODAS as celulas
   * acessiveis a partir da origem. Usado para interceptacao de comida
   * e consultas multiplas de distancia sem repetir BFS.
   */
  static _bfsCompleto(origem, obstaculos, largura, altura, bordaArena) {
    const distancias = new Map();
    const chaveOrigem = origem.y * largura + origem.x;
    distancias.set(chaveOrigem, 0);

    const fila = [origem.x, origem.y, 0];
    let inicio = 0;

    while (inicio < fila.length) {
      const ax = fila[inicio++];
      const ay = fila[inicio++];
      const ad = fila[inicio++];

      for (let v = 0; v < 4; v++) {
        const nx = ax + VIZINHOS[v][0];
        const ny = ay + VIZINHOS[v][1];

        if (nx < bordaArena || nx >= largura - bordaArena ||
            ny < bordaArena || ny >= altura - bordaArena) continue;

        const chave = ny * largura + nx;
        if (distancias.has(chave) || obstaculos.has(chave)) continue;

        distancias.set(chave, ad + 1);
        fila.push(nx, ny, ad + 1);
      }
    }
    return distancias;
  }

  /**
   * Flood fill: conta quantas celulas sao acessiveis a partir da origem.
   * Usa DFS (pilha plana) para menor overhead de memoria.
   */
  static _floodFill(origem, obstaculos, largura, altura, bordaArena) {
    const chaveOrigem = origem.y * largura + origem.x;
    if (obstaculos.has(chaveOrigem)) return 0;

    const visitado = new Set([chaveOrigem]);
    const pilha = [origem.x, origem.y];
    let contagem = 0;

    while (pilha.length > 0) {
      const ay = pilha.pop();
      const ax = pilha.pop();
      contagem++;

      for (let v = 0; v < 4; v++) {
        const nx = ax + VIZINHOS[v][0];
        const ny = ay + VIZINHOS[v][1];

        if (nx < bordaArena || nx >= largura - bordaArena ||
            ny < bordaArena || ny >= altura - bordaArena) continue;

        const chave = ny * largura + nx;
        if (visitado.has(chave) || obstaculos.has(chave)) continue;

        visitado.add(chave);
        pilha.push(nx, ny);
      }
    }
    return contagem;
  }

  /**
   * Calcula valor contextual de uma comida (modo dificil).
   * Escudo eh muito valioso perto de oponentes; dourada da crescimento
   * rapido; vida eh critica com poucas vidas restantes.
   */
  static _valorComida(comida, bot, oponentes) {
    switch (comida.tipo) {
      case 'dourada': return 2.5;
      case 'escudo': {
        if (bot.efeitos.escudo.ativo) return 1.0; // ja temos, valor normal
        const temOponentePerto = oponentes.some(o => {
          const d = Math.abs(o.cobra[0].x - bot.cobra[0].x) +
                    Math.abs(o.cobra[0].y - bot.cobra[0].y);
          return d <= 12;
        });
        return temOponentePerto ? 4.0 : 2.0;
      }
      case 'vida': return bot.vidas <= 1 ? 3.5 : 1.5;
      case 'velocidade': return 1.3;
      default: return 1.0;
    }
  }

  /**
   * Avalia resultado de um confronto cabeca-cabeca entre bot e oponente.
   * Retorna valor positivo (buscar confronto) ou negativo (evitar).
   * Leva em conta escudos e diferenca de tamanho.
   */
  static _avaliarConfronto(bot, oponente) {
    const escudoBot = bot.efeitos.escudo.ativo;
    const escudoOpo = oponente.efeitos.escudo.ativo;

    // Escudo do oponente reflete — NUNCA atacar (exceto se temos escudo)
    if (escudoOpo && !escudoBot) return -80;

    // Nosso escudo ativo: matamos no head-on garantido
    if (escudoBot && !escudoOpo) return 60;

    // Ambos com escudo: head-on nao tem efeito
    if (escudoBot && escudoOpo) return 0;

    // Sem escudos: decisao por tamanho
    const diff = bot.cobra.length - oponente.cobra.length;
    if (diff > 3) return 40;     // muito maior: atacar
    if (diff > 1) return 20;     // maior: atacar com cautela
    if (diff === 1) return 5;    // levemente maior: atacar se conveniente
    if (diff === 0) return -25;  // iguais: ambos perdem, evitar
    if (diff >= -2) return -40;  // menor: fugir
    return -60;                   // muito menor: fugir rapido
  }

  /* =========================================================================
   * DECISAO PRINCIPAL
   * ======================================================================= */

  /**
   * Decide a melhor direcao para o bot se mover.
   *
   * @param {object} bot - Dados do jogador-bot.
   * @param {object[]} todosJogadores - Array com todos os jogadores da sala.
   * @param {object[]} comidas - Array de comidas no mapa.
   * @param {number} largura - Largura do grid.
   * @param {number} altura - Altura do grid.
   * @param {string} dificuldade - Nivel: 'facil' | 'normal' | 'dificil'.
   * @param {number} bordaArena - Celulas de borda (arena encolhendo).
   * @returns {string} Direcao escolhida.
   */
  static decidirDirecao(bot, todosJogadores, comidas, largura, altura, dificuldade, bordaArena = 0) {
    if (!bot.vivo || bot.cobra.length === 0) return bot.direcao;

    const cfg = DIFICULDADES[dificuldade] || DIFICULDADES.normal;
    const cabeca = bot.cobra[0];
    const oposta = CONSTANTES.DIRECAO_OPOSTA[bot.direcao];
    const possiveisDirecoes = TODAS_DIRECOES.filter(d => d !== oposta);

    // --- Construir obstaculos (uma vez por decisao) ---
    const obstaculos = this._construirObstaculos(todosJogadores, largura);
    // Remover a propria cauda dos obstaculos (vai se mover no proximo tick)
    const cauda = bot.cobra[bot.cobra.length - 1];
    obstaculos.delete(cauda.y * largura + cauda.x);

    // Oponentes vivos
    const oponentes = [];
    for (const j of todosJogadores) {
      if (j.id !== bot.id && j.vivo && j.cobra.length > 0) oponentes.push(j);
    }

    // --- Pre-computacoes (modo dificil) ---

    // BFS completo de cada oponente para interceptacao de comida
    let bfsOponentes = null;
    if (cfg.interceptar && oponentes.length > 0 && comidas.length > 0) {
      bfsOponentes = new Map();
      for (const op of oponentes) {
        bfsOponentes.set(op.id, this._bfsCompleto(
          op.cobra[0], obstaculos, largura, altura, bordaArena
        ));
      }
    }

    // Flood fill base de cada oponente proximo (para medir reducao de espaco)
    let espacoBaseOponentes = null;
    if (cfg.reducaoEspaco && oponentes.length > 0) {
      espacoBaseOponentes = new Map();
      for (const op of oponentes) {
        const dist = Math.abs(op.cobra[0].x - cabeca.x) +
                     Math.abs(op.cobra[0].y - cabeca.y);
        if (dist <= 12) {
          espacoBaseOponentes.set(op.id, this._floodFill(
            op.cobra[0], obstaculos, largura, altura, bordaArena
          ));
        }
      }
    }

    // Chave da cauda para tail-chase
    const chaveCauda = cauda.y * largura + cauda.x;

    // --- Ajuste dinamico de pesos por tamanho (hard mode: cobra pequena foca comida) ---
    let multComida = 1.0;
    let multAtaque = 1.0;
    if (cfg.comidaInteligente) {
      if (bot.cobra.length < 6) {
        multComida = 1.6;
        multAtaque = 0.3;
      } else if (bot.cobra.length < 10) {
        multComida = 1.2;
        multAtaque = 0.7;
      } else {
        multComida = 0.8;
        multAtaque = 1.3;
      }
      // Invulneravel (recém respawnou): focar em comer, nao atacar
      if (bot.invulneravel) {
        multComida *= 1.8;
        multAtaque *= 0.1;
      }
    }

    // --- Avaliar cada direcao candidata ---
    const avaliacoes = possiveisDirecoes.map(direcao => {
      const vetor = CONSTANTES.DIRECOES[direcao];
      const pos = { x: cabeca.x + vetor.x, y: cabeca.y + vetor.y };
      const chavePos = pos.y * largura + pos.x;

      // ---- Seguranca basica: parede ou corpo ----
      if (pos.x < bordaArena || pos.x >= largura - bordaArena ||
          pos.y < bordaArena || pos.y >= altura - bordaArena) {
        return { direcao, seguro: false, pontuacao: -1000 };
      }
      if (obstaculos.has(chavePos)) {
        return { direcao, seguro: false, pontuacao: -1000 };
      }

      let pontuacaoComida = 0;
      let pontuacaoAtaque = 0;
      let pontuacaoSeguranca = 0;
      let pontuacaoEspaco = 0;

      // ============================================================
      // COMIDA
      // ============================================================
      if (comidas.length > 0) {
        if (cfg.usarBFS) {
          if (cfg.comidaInteligente) {
            // --- Modo dificil: valor/distancia + interceptacao ---
            const bfsBot = this._bfsCompleto(
              pos, obstaculos, largura, altura, bordaArena
            );

            let melhorPontuacao = -Infinity;
            for (const c of comidas) {
              const chaveComida = c.posicao.y * largura + c.posicao.x;
              const dist = bfsBot.get(chaveComida);
              if (dist === undefined) continue;

              let valor = this._valorComida(c, bot, oponentes);

              // Interceptacao: bonus se chegamos antes do oponente
              if (bfsOponentes) {
                let menorDistOpo = Infinity;
                for (const [, bfsOp] of bfsOponentes) {
                  const distOp = bfsOp.get(chaveComida);
                  if (distOp !== undefined && distOp < menorDistOpo) {
                    menorDistOpo = distOp;
                  }
                }
                if (dist < menorDistOpo) {
                  valor *= 1.5; // chegamos primeiro
                } else if (dist > menorDistOpo + 3) {
                  valor *= 0.4; // oponente chega muito antes, nao vale
                }
              }

              const pontuacao = valor / Math.max(1, dist);
              if (pontuacao > melhorPontuacao) melhorPontuacao = pontuacao;
            }
            pontuacaoComida = melhorPontuacao === -Infinity ? -5 : melhorPontuacao * 15;

            // Reutilizar BFS do bot para tail-chase (evita BFS extra)
            if (cfg.perseguirCauda) {
              const distCaudaBfs = bfsBot.get(chaveCauda);
              if (distCaudaBfs !== undefined) {
                // Salvar para uso na secao de espaco
                pos._distCauda = distCaudaBfs;
              }
            }
          } else {
            // --- Modo normal: BFS para comida mais proxima ---
            const alvos = comidas.map(c => ({ x: c.posicao.x, y: c.posicao.y }));
            const dist = this._bfs(pos, alvos, obstaculos, largura, altura, bordaArena);
            pontuacaoComida = dist === Infinity ? -30 : -dist;
          }
        } else {
          // --- Modo facil: Manhattan distance simples ---
          let menorDist = Infinity;
          for (const c of comidas) {
            const d = Math.abs(c.posicao.x - pos.x) + Math.abs(c.posicao.y - pos.y);
            if (d < menorDist) menorDist = d;
          }
          pontuacaoComida = -menorDist;
        }
      }

      // ============================================================
      // ATAQUE
      // ============================================================
      if (cfg.pesoAtaque > 0) {
        for (const oponente of oponentes) {
          const cabecaOutro = oponente.cobra[0];
          const distCabeca = Math.abs(cabecaOutro.x - pos.x) +
                             Math.abs(cabecaOutro.y - pos.y);

          // --- Confronto cabeca-cabeca inteligente ---
          if (distCabeca <= 6) {
            const valorConfronto = this._avaliarConfronto(bot, oponente);
            const fatorProximidade = (7 - distCabeca) / 6;
            pontuacaoAtaque += valorConfronto * fatorProximidade;
          }

          // --- Atacar corpo do oponente (cortar segmentos) ---
          // Nao atacar se oponente tem escudo (atacante morre!)
          if (!oponente.efeitos.escudo.ativo) {
            for (let s = 1; s < oponente.cobra.length; s++) {
              const seg = oponente.cobra[s];
              const distSeg = Math.abs(seg.x - pos.x) + Math.abs(seg.y - pos.y);
              if (distSeg <= 4) {
                // Segmentos perto da cabeca removem mais (mais dano)
                const segmentosRemovidos = oponente.cobra.length - s;
                const fatorDano = segmentosRemovidos / oponente.cobra.length;
                pontuacaoAtaque += (5 - distSeg) * 5 * fatorDano;
              }
            }
          } else if (distCabeca <= 4) {
            // Oponente com escudo: FUGIR (bater no corpo dele nos mata)
            pontuacaoAtaque -= (5 - distCabeca) * 15;
          }

          // --- Contestar saidas do oponente (cut-off) ---
          if (cfg.reducaoEspaco && bot.cobra.length > oponente.cobra.length) {
            let alvoX = cabecaOutro.x;
            let alvoY = cabecaOutro.y;
            if (cfg.preverMovimento) {
              const vetOpo = CONSTANTES.DIRECOES[oponente.direcao];
              alvoX += vetOpo.x;
              alvoY += vetOpo.y;
            }
            for (let v = 0; v < 4; v++) {
              const nx = alvoX + VIZINHOS[v][0];
              const ny = alvoY + VIZINHOS[v][1];
              const distSaida = Math.abs(pos.x - nx) + Math.abs(pos.y - ny);
              if (distSaida <= 3) {
                pontuacaoAtaque += (4 - distSaida) * 5;
              }
            }
          }

          // --- Medir reducao de espaco do oponente ---
          if (cfg.reducaoEspaco && espacoBaseOponentes &&
              espacoBaseOponentes.has(oponente.id) && distCabeca <= 10) {
            obstaculos.add(chavePos);
            const espacoCom = this._floodFill(
              cabecaOutro, obstaculos, largura, altura, bordaArena
            );
            obstaculos.delete(chavePos);

            const espacoBase = espacoBaseOponentes.get(oponente.id);
            const reducao = espacoBase - espacoCom;
            if (reducao > 3) {
              pontuacaoAtaque += Math.min(reducao, 40) * 1.5;
            }
          }
        }

        // Boost de agressividade com velocidade ativa
        if (bot.efeitos.velocidade.ativo) {
          pontuacaoAtaque *= 1.2;
        }
      }

      // ============================================================
      // SEGURANCA
      // ============================================================
      const distParede = Math.min(
        pos.x - bordaArena,
        pos.y - bordaArena,
        (largura - 1 - bordaArena) - pos.x,
        (altura - 1 - bordaArena) - pos.y
      );
      if (distParede <= 1) pontuacaoSeguranca -= 10;
      else if (distParede <= 3) pontuacaoSeguranca -= 3;

      // Preferencia leve pelo centro (ajuda com arena encolhendo)
      const centroX = largura / 2;
      const centroY = altura / 2;
      pontuacaoSeguranca -= (Math.abs(pos.x - centroX) + Math.abs(pos.y - centroY)) * 0.15;

      // ============================================================
      // ESPACO (flood fill / look-ahead)
      // ============================================================
      if (cfg.usarFloodFill) {
        const espaco = this._floodFill(pos, obstaculos, largura, altura, bordaArena);

        if (espaco < bot.cobra.length) {
          // Beco sem saida fatal — penalidade pesada
          pontuacaoEspaco -= 200;
        } else if (espaco < bot.cobra.length * 1.5) {
          // Corredor apertado
          pontuacaoEspaco -= 50;
        } else if (espaco < bot.cobra.length * 3) {
          // Espaco limitado mas aceitavel
          pontuacaoEspaco += espaco * 0.3;
        } else {
          // Espaco amplo
          pontuacaoEspaco += Math.min(espaco, 120) * 0.5;
        }

        // Perseguir propria cauda quando encurralado (cria rota ciclica segura)
        if (cfg.perseguirCauda && espaco < bot.cobra.length * 2) {
          let distCauda = pos._distCauda; // reutiliza BFS do modo dificil
          if (distCauda === undefined) {
            distCauda = this._bfs(pos, [cauda], obstaculos, largura, altura, bordaArena);
          }
          if (distCauda !== Infinity) {
            pontuacaoEspaco += (25 - Math.min(distCauda, 25)) * 3;
          }
        }
      } else {
        // Modo facil: look-ahead de 1 nivel (contar saidas seguras)
        let saidasSeguras = 0;
        for (let v = 0; v < 4; v++) {
          const d2 = TODAS_DIRECOES[v];
          if (d2 === CONSTANTES.DIRECAO_OPOSTA[direcao]) continue;
          const v2 = CONSTANTES.DIRECOES[d2];
          const p2 = { x: pos.x + v2.x, y: pos.y + v2.y };

          if (p2.x < bordaArena || p2.x >= largura - bordaArena ||
              p2.y < bordaArena || p2.y >= altura - bordaArena) continue;
          if (obstaculos.has(p2.y * largura + p2.x)) continue;
          saidasSeguras++;
        }
        if (saidasSeguras === 0) pontuacaoSeguranca -= 50;
        else pontuacaoSeguranca += saidasSeguras * 2;
      }

      // Bonus de inercia (pequeno, para evitar giros desnecessarios)
      const inercia = (direcao === bot.direcao) ? 3 : 0;

      // Pontuacao final ponderada (com ajuste dinamico para hard mode)
      const pontuacao =
        pontuacaoComida * cfg.pesoComida * multComida +
        pontuacaoAtaque * cfg.pesoAtaque * multAtaque +
        pontuacaoSeguranca * cfg.pesoSeguranca +
        pontuacaoEspaco * cfg.pesoEspaco +
        inercia;

      return { direcao, seguro: true, pontuacao };
    });

    // --- Escolher melhor direcao segura ---
    const seguros = avaliacoes.filter(a => a.seguro);

    if (seguros.length > 0) {
      seguros.sort((a, b) => b.pontuacao - a.pontuacao);

      // Chance de erro: escolher direcao aleatoria (modos facil/normal)
      if (cfg.chanceErro > 0 && seguros.length > 1 && Math.random() < cfg.chanceErro) {
        return seguros[Math.floor(Math.random() * seguros.length)].direcao;
      }

      return seguros[0].direcao;
    }

    // Sem direcao segura: manter atual (morte iminente)
    return bot.direcao;
  }
}

module.exports = BotIA;
