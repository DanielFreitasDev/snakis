/**
 * @fileoverview Inteligencia Artificial dos bots para o modo multiplayer.
 *
 * Cada bot avalia as direcoes possiveis a cada tick e escolhe a melhor
 * com base em: seguranca, proximidade de comida, comportamento agressivo
 * (atacar outras cobras) e espaco disponivel adiante.
 *
 * O nivel de dificuldade controla os pesos entre buscar comida vs atacar,
 * a presenca de look-ahead e a chance de erros aleatorios.
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
 * pesoComida     — quanto o bot prioriza buscar comida
 * pesoAtaque     — quanto o bot prioriza atacar outras cobras
 * pesoSeguranca  — quanto o bot penaliza proximidade de parede
 * chanceErro     — probabilidade de escolher uma direcao nao-otima
 * usarLookAhead  — se avalia saidas seguras a partir da nova posicao
 */
const DIFICULDADES = {
  facil: {
    pesoComida: 1.0,
    pesoAtaque: 0.1,
    pesoSeguranca: 0.8,
    chanceErro: 0.2,
    usarLookAhead: false,
  },
  normal: {
    pesoComida: 0.7,
    pesoAtaque: 0.5,
    pesoSeguranca: 1.0,
    chanceErro: 0.05,
    usarLookAhead: true,
  },
  dificil: {
    pesoComida: 0.4,
    pesoAtaque: 1.0,
    pesoSeguranca: 1.2,
    chanceErro: 0,
    usarLookAhead: true,
  },
};

const TODAS_DIRECOES = ['cima', 'baixo', 'esquerda', 'direita'];

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

  /**
   * Decide a melhor direcao para o bot se mover.
   *
   * @param {object} bot - Dados do jogador-bot.
   * @param {object[]} todosJogadores - Array com todos os jogadores da sala.
   * @param {object[]} comidas - Array de comidas no mapa.
   * @param {number} largura - Largura do grid.
   * @param {number} altura - Altura do grid.
   * @param {string} dificuldade - Nivel: 'facil' | 'normal' | 'dificil'.
   * @returns {string} Direcao escolhida.
   */
  static decidirDirecao(bot, todosJogadores, comidas, largura, altura, dificuldade, bordaArena = 0) {
    if (!bot.vivo || bot.cobra.length === 0) return bot.direcao;

    const cfg = DIFICULDADES[dificuldade] || DIFICULDADES.normal;
    const cabeca = bot.cobra[0];
    const oposta = CONSTANTES.DIRECAO_OPOSTA[bot.direcao];
    const possiveisDirecoes = TODAS_DIRECOES.filter(d => d !== oposta);

    const avaliacoes = possiveisDirecoes.map(direcao => {
      const vetor = CONSTANTES.DIRECOES[direcao];
      const pos = { x: cabeca.x + vetor.x, y: cabeca.y + vetor.y };

      // --- Verificacoes de seguranca (sempre aplicam) ---

      // Parede (incluindo borda da arena)
      if (pos.x < bordaArena || pos.x >= largura - bordaArena || pos.y < bordaArena || pos.y >= altura - bordaArena) {
        return { direcao, seguro: false, pontuacao: -1000 };
      }

      // Proprio corpo
      if (bot.cobra.some(s => s.x === pos.x && s.y === pos.y)) {
        return { direcao, seguro: false, pontuacao: -1000 };
      }

      // Corpo de outra cobra
      for (const j of todosJogadores) {
        if (j.id === bot.id || !j.vivo) continue;
        if (j.cobra.some(s => s.x === pos.x && s.y === pos.y)) {
          return { direcao, seguro: false, pontuacao: -1000 };
        }
      }

      // --- Direcao segura, calcular pontuacoes por categoria ---
      let pontuacaoComida = 0;
      let pontuacaoAtaque = 0;
      let pontuacaoSeguranca = 0;

      // ====== COMIDA ======
      if (comidas.length > 0) {
        let menorDist = Infinity;
        for (const c of comidas) {
          const d = Math.abs(c.posicao.x - pos.x) + Math.abs(c.posicao.y - pos.y);
          if (d < menorDist) menorDist = d;
        }
        pontuacaoComida = -menorDist;
      }

      // ====== ATAQUE (agressividade contra outras cobras) ======
      for (const j of todosJogadores) {
        if (j.id === bot.id || !j.vivo || j.cobra.length === 0) continue;

        // Proximidade ao corpo do oponente (potencial de cortar)
        for (let s = 1; s < j.cobra.length; s++) {
          const seg = j.cobra[s];
          const dist = Math.abs(seg.x - pos.x) + Math.abs(seg.y - pos.y);
          if (dist <= 3) {
            pontuacaoAtaque += (4 - dist) * 4;
          }
        }

        // Se somos maiores, buscar confronto cabeca-cabeca
        const cabecaOutro = j.cobra[0];
        const distCabeca = Math.abs(cabecaOutro.x - pos.x) + Math.abs(cabecaOutro.y - pos.y);
        if (bot.cobra.length > j.cobra.length && distCabeca <= 5) {
          pontuacaoAtaque += (6 - distCabeca) * 3;
        }

        // Com escudo ativo, ser mais agressivo
        if (bot.efeitos.escudo.ativo && distCabeca <= 5) {
          pontuacaoAtaque += (6 - distCabeca) * 5;
        }

        // Evitar cabeca de oponente maior (risco de perder head-on)
        if (bot.cobra.length <= j.cobra.length && distCabeca <= 2) {
          pontuacaoAtaque -= 12;
        }
      }

      // ====== SEGURANCA (paredes e espaco) ======
      const distParede = Math.min(pos.x - bordaArena, pos.y - bordaArena, largura - 1 - bordaArena - pos.x, altura - 1 - bordaArena - pos.y);
      if (distParede <= 1) pontuacaoSeguranca -= 10;
      else if (distParede <= 3) pontuacaoSeguranca -= 3;

      // Look-ahead: saidas seguras a partir da nova posicao
      if (cfg.usarLookAhead) {
        let saidasSeguras = 0;
        for (const d2 of TODAS_DIRECOES) {
          if (d2 === CONSTANTES.DIRECAO_OPOSTA[direcao]) continue;
          const v2 = CONSTANTES.DIRECOES[d2];
          const p2 = { x: pos.x + v2.x, y: pos.y + v2.y };

          if (p2.x < bordaArena || p2.x >= largura - bordaArena || p2.y < bordaArena || p2.y >= altura - bordaArena) continue;
          if (bot.cobra.some(s => s.x === p2.x && s.y === p2.y)) continue;

          let bloqueado = false;
          for (const j of todosJogadores) {
            if (j.id === bot.id || !j.vivo) continue;
            if (j.cobra.some(s => s.x === p2.x && s.y === p2.y)) { bloqueado = true; break; }
          }
          if (!bloqueado) saidasSeguras++;
        }

        if (saidasSeguras === 0) pontuacaoSeguranca -= 50;
        else pontuacaoSeguranca += saidasSeguras * 2;
      }

      // Bonus de inercia: preferir manter a direcao atual para evitar giros em circulo
      const inercia = (direcao === bot.direcao) ? 8 : 0;

      // Pontuacao final ponderada pelos pesos da dificuldade
      const pontuacao =
        pontuacaoComida * cfg.pesoComida +
        pontuacaoAtaque * cfg.pesoAtaque +
        pontuacaoSeguranca * cfg.pesoSeguranca +
        inercia;

      return { direcao, seguro: true, pontuacao };
    });

    // Escolher entre as direcoes seguras
    const seguros = avaliacoes.filter(a => a.seguro);

    if (seguros.length > 0) {
      seguros.sort((a, b) => b.pontuacao - a.pontuacao);

      // Chance de erro: escolher direcao aleatoria em vez da melhor
      if (cfg.chanceErro > 0 && seguros.length > 1 && Math.random() < cfg.chanceErro) {
        return seguros[Math.floor(Math.random() * seguros.length)].direcao;
      }

      return seguros[0].direcao;
    }

    // Sem saida segura, manter direcao atual
    return bot.direcao;
  }
}

module.exports = BotIA;
