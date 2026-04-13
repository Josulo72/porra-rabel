const KEY = 'PORRA_SHARED_STATE_V1';
const WHATSAPP_CONFIG_KEY = 'PORRA_WHATSAPP_CONFIG';
const TELEGRAM_CONFIG_KEY = 'PORRA_TELEGRAM_CONFIG';
const PREV_SCORES_KEY = 'PORRA_PREV_SCORES';
const MATCH_PHASES_KEY = 'PORRA_MATCH_PHASES';

/**
 * CallMeBot WhatsApp: configuración y envío automático de mensajes.
 * Cada destinatario necesita activarse una vez en https://www.callmebot.com/blog/free-api-whatsapp-messages/
 * Envía un WhatsApp gratis con: https://api.callmebot.com/whatsapp.php?phone=NUMERO&text=MENSAJE&apikey=APIKEY
 */
function getWhatsAppConfig_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(WHATSAPP_CONFIG_KEY);
  if (!raw) return { enabled: false, recipients: [] };
  try { return JSON.parse(raw); } catch (e) { return { enabled: false, recipients: [] }; }
}

function setWhatsAppConfig_(config) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(WHATSAPP_CONFIG_KEY, JSON.stringify(config || { enabled: false, recipients: [] }));
}

function sendWhatsApp_(message) {
  var config = getWhatsAppConfig_();
  if (!config.enabled || !config.recipients || !config.recipients.length) return;
  var encoded = encodeURIComponent(message);
  for (var r = 0; r < config.recipients.length; r++) {
    try {
      var rec = config.recipients[r];
      if (!rec.phone || !rec.apikey) continue;
      var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(rec.phone) + '&text=' + encoded + '&apikey=' + encodeURIComponent(rec.apikey);
      UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      // CallMeBot rate limit: 1 msg/sec por número
      Utilities.sleep(1500);
    } catch (e) {
      // no bloquear por error de un destinatario
    }
  }
}

/**
 * Telegram Bot: envía mensajes a un grupo de Telegram automáticamente.
 * Instrucciones para el admin:
 * 1. Habla con @BotFather en Telegram → /newbot → te da un TOKEN
 * 2. Crea un grupo de Telegram y mete al bot
 * 3. Envía un mensaje en el grupo y luego visita:
 *    https://api.telegram.org/bot<TOKEN>/getUpdates
 *    para obtener el chat_id del grupo (número negativo)
 * 4. Pon el token y chat_id en el panel admin de la Porra
 */
function getTelegramConfig_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(TELEGRAM_CONFIG_KEY);
  if (!raw) return { enabled: false, botToken: '', chatId: '' };
  try { return JSON.parse(raw); } catch (e) { return { enabled: false, botToken: '', chatId: '' }; }
}

function setTelegramConfig_(config) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(TELEGRAM_CONFIG_KEY, JSON.stringify(config || { enabled: false, botToken: '', chatId: '' }));
}

function sendTelegram_(message) {
  var config = getTelegramConfig_();
  if (!config.enabled || !config.botToken || !config.chatId) return;
  try {
    var url = 'https://api.telegram.org/bot' + config.botToken + '/sendMessage';
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    // no bloquear
  }
}

/**
 * Envía notificación por todos los canales configurados (WhatsApp + Telegram).
 */
function notifyAll_(message) {
  sendWhatsApp_(message);
  sendTelegram_(message);
}

function getPrevScores_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(PREV_SCORES_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function setPrevScores_(scores) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PREV_SCORES_KEY, JSON.stringify(scores || {}));
}

function getMatchPhases_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(MATCH_PHASES_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function setMatchPhases_(phases) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(MATCH_PHASES_KEY, JSON.stringify(phases || {}));
}

/**
 * Calcula la fase actual de un partido basándose en la hora de kickoff.
 * Fases: 'pre' → 'first_half' → 'halftime' → 'second_half' → 'fulltime'
 * Tiempos aproximados:
 *   Kickoff = inicio primera parte
 *   +47 min = descanso (45 min + 2 de añadido aprox)
 *   +63 min = inicio segunda parte (~15 min de descanso)
 *   +112 min = final del partido (45+2 + 15 + 45+5 aprox)
 */
function getMatchPhaseByTime_(kickoff) {
  if (!kickoff) return 'pre';
  var now = new Date();
  var ko = new Date(kickoff);
  var elapsed = (now.getTime() - ko.getTime()) / 60000; // minutos desde kickoff

  if (elapsed < 0) return 'pre';
  if (elapsed < 47) return 'first_half';
  if (elapsed < 63) return 'halftime';
  if (elapsed < 112) return 'second_half';
  return 'fulltime';
}

/**
 * Comprueba las fases de todos los partidos y envía WhatsApp si hay transición.
 * Se llama cada vez que se hace scraping.
 */
function checkMatchPhasesAndNotify_() {
  var state = getState_();
  var phases = getMatchPhases_();
  var changed = false;

  for (var i = 0; i < state.matches.length; i++) {
    var match = state.matches[i];
    if (!match.kickoff || !match.homeTeam || !match.awayTeam) continue;

    var key = match.id;
    var prevPhase = phases[key] || 'pre';
    var currentPhase = getMatchPhaseByTime_(match.kickoff);

    if (currentPhase === prevPhase) continue;

    // Detectada transición de fase
    phases[key] = currentPhase;
    changed = true;

    var label = match.homeTeam + ' vs ' + match.awayTeam;
    var scoreText = '';
    if (match.result && match.result.home !== null && match.result.away !== null) {
      scoreText = ' (' + match.result.home + '-' + match.result.away + ')';
    }

    var msg = '';
    switch (currentPhase) {
      case 'first_half':
        msg = '🟢 *¡COMIENZA EL PARTIDO!*\n⚽ ' + label + '\n\nPredicciones cerradas. ¡Suerte a todos!';
        break;
      case 'halftime':
        msg = '⏸️ *DESCANSO*\n⚽ ' + label + scoreText + '\n\nVolvemos en 15 minutos.';
        // Añadir resumen de supervivientes
        var alive1 = countAlive_(state, i);
        if (alive1 !== null) msg += '\n🏆 ' + alive1.alive + '/' + alive1.total + ' supervivientes';
        break;
      case 'second_half':
        msg = '🟢 *¡SE REANUDA EL PARTIDO!*\n⚽ ' + label + scoreText;
        break;
      case 'fulltime':
        msg = '🏁 *¡FINAL DEL PARTIDO!*\n⚽ ' + label + scoreText;
        // Resumen completo de eliminados
        var summary = getMatchSummary_(state, i);
        if (summary) msg += '\n\n' + summary;
        break;
    }

    if (msg) notifyAll_(msg);
  }

  if (changed) setMatchPhases_(phases);
}

/**
 * Cuenta participantes vivos hasta el partido i (inclusive).
 */
function countAlive_(state, upToMatch) {
  if (!state.participants || !state.participants.length) return null;
  var alive = 0;
  var total = state.participants.length;
  for (var p = 0; p < state.participants.length; p++) {
    var isAlive = true;
    for (var m = 0; m <= upToMatch; m++) {
      var mr = state.matches[m] && state.matches[m].result;
      if (!mr || mr.home === null || mr.away === null) continue;
      var pred = state.participants[p].predictions && state.participants[p].predictions[m];
      if (!pred || pred.home === null || pred.away === null ||
          Number(pred.home) !== mr.home || Number(pred.away) !== mr.away) {
        isAlive = false;
        break;
      }
    }
    if (isAlive) alive++;
  }
  return { alive: alive, total: total };
}

/**
 * Genera resumen de eliminados y supervivientes para un partido.
 */
function getMatchSummary_(state, matchIdx) {
  var mr = state.matches[matchIdx] && state.matches[matchIdx].result;
  if (!mr || mr.home === null || mr.away === null) return '';

  var eliminated = [];
  var survived = [];
  for (var p = 0; p < state.participants.length; p++) {
    var part = state.participants[p];
    // Comprobar si ya estaba eliminado en partidos anteriores
    var alreadyDead = false;
    for (var m = 0; m < matchIdx; m++) {
      var prevR = state.matches[m] && state.matches[m].result;
      if (!prevR || prevR.home === null) continue;
      var prevPred = part.predictions && part.predictions[m];
      if (!prevPred || prevPred.home === null || prevPred.away === null ||
          Number(prevPred.home) !== prevR.home || Number(prevPred.away) !== prevR.away) {
        alreadyDead = true;
        break;
      }
    }
    if (alreadyDead) continue; // ya estaba eliminado antes

    var pred = part.predictions && part.predictions[matchIdx];
    if (!pred || pred.home === null || pred.away === null ||
        Number(pred.home) !== mr.home || Number(pred.away) !== mr.away) {
      eliminated.push(part.name);
    } else {
      survived.push(part.name);
    }
  }

  var lines = [];
  lines.push('📊 *Resultado: ' + mr.home + '-' + mr.away + '*');
  if (eliminated.length) {
    lines.push('💀 *Eliminados (' + eliminated.length + '):* ' + eliminated.join(', '));
  } else {
    lines.push('🎉 ¡Nadie eliminado en este partido!');
  }
  lines.push('🏆 *Supervivientes: ' + survived.length + '/' + (survived.length + eliminated.length) + '*');
  if (survived.length && survived.length <= 10) {
    lines.push('✅ ' + survived.join(', '));
  }
  return lines.join('\n');
}

const DEFAULT_STATE = {
  matches: [
    { id: 'm1', order: 1, homeTeam: 'Real Madrid', awayTeam: '', kickoff: '', result: { home: null, away: null }, source: 'manual', lastUpdated: null },
    { id: 'm2', order: 2, homeTeam: 'FC Barcelona', awayTeam: '', kickoff: '', result: { home: null, away: null }, source: 'manual', lastUpdated: null },
    { id: 'm3', order: 3, homeTeam: 'SD Ponferradina', awayTeam: '', kickoff: '', result: { home: null, away: null }, source: 'manual', lastUpdated: null },
  ],
  participants: [],
};

function toJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getState_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return DEFAULT_STATE;
  }
}

function setState_(state) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(KEY, JSON.stringify(state || DEFAULT_STATE));
}

/**
 * Normaliza nombre de equipo: quita prefijos comunes (SD, CF, FC, CD, UD, etc.)
 * y pasa a minúsculas para matching más fiable.
 */
function normalizeTeamName_(name) {
  return String(name || '').toLowerCase()
    .replace(/^(sd|cf|fc|cd|ud|ca|rc|rcd|real|deportivo|sociedad deportiva|club)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compara dos nombres de equipo de forma flexible.
 * Devuelve true si uno contiene al otro (tras normalizar).
 */
function teamsMatch_(name1, name2) {
  var a = normalizeTeamName_(name1);
  var b = normalizeTeamName_(name2);
  if (!a || !b) return false;
  // Coincidencia exacta tras normalizar
  if (a === b) return true;
  // Uno contiene al otro
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  return false;
}

/**
 * Proxy de scraping: llama a TheSportsDB desde el servidor de Google
 * para evitar bloqueos CORS del navegador.
 * Busca el partido por nombre de equipo y devuelve el marcador si existe.
 * Intenta múltiples estrategias de búsqueda.
 */
function scrapeScores_(homeTeam, awayTeam) {
  // Estrategia 1: buscar eventos por nombre completo
  var queries = [
    homeTeam + ' vs ' + awayTeam,
    awayTeam + ' vs ' + homeTeam,
    homeTeam,
    awayTeam,
  ];

  for (var q = 0; q < queries.length; q++) {
    try {
      var url = 'https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=' + encodeURIComponent(queries[q]);
      var response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'Accept': 'application/json' }
      });
      var data = JSON.parse(response.getContentText());
      var events = data && data.event ? data.event : [];

      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var homeOk = teamsMatch_(ev.strHomeTeam, homeTeam);
        var awayOk = teamsMatch_(ev.strAwayTeam, awayTeam);
        // También probar invertido por si la API tiene local/visitante al revés
        var homeOkInv = teamsMatch_(ev.strHomeTeam, awayTeam);
        var awayOkInv = teamsMatch_(ev.strAwayTeam, homeTeam);

        var matched = (homeOk && awayOk) || (homeOkInv && awayOkInv);
        if (matched && ev.intHomeScore !== null && ev.intHomeScore !== undefined && ev.intHomeScore !== '') {
          var hScore = parseInt(ev.intHomeScore, 10);
          var aScore = parseInt(ev.intAwayScore, 10);
          // Si el match fue invertido, invertir también los scores
          if (homeOkInv && awayOkInv && !homeOk) {
            var tmp = hScore; hScore = aScore; aScore = tmp;
          }
          return {
            found: true,
            home: hScore,
            away: aScore,
            homeTeam: ev.strHomeTeam,
            awayTeam: ev.strAwayTeam,
            status: ev.strStatus || '',
            event: ev.strEvent || ''
          };
        }
      }
    } catch (e) {
      // continúa con siguiente query
    }
  }

  // Estrategia 2: buscar últimos eventos del equipo local por id
  try {
    var searchUrl = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=' + encodeURIComponent(homeTeam);
    var searchRes = UrlFetchApp.fetch(searchUrl, { muteHttpExceptions: true });
    var searchData = JSON.parse(searchRes.getContentText());
    var teams = searchData && searchData.teams ? searchData.teams : [];

    for (var t = 0; t < teams.length; t++) {
      if (!teamsMatch_(teams[t].strTeam, homeTeam)) continue;
      var teamId = teams[t].idTeam;
      var lastUrl = 'https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=' + teamId;
      var lastRes = UrlFetchApp.fetch(lastUrl, { muteHttpExceptions: true });
      var lastData = JSON.parse(lastRes.getContentText());
      var lastEvents = lastData && lastData.results ? lastData.results : [];

      for (var le = 0; le < lastEvents.length; le++) {
        var lev = lastEvents[le];
        var normalMatch = teamsMatch_(lev.strHomeTeam, homeTeam) && teamsMatch_(lev.strAwayTeam, awayTeam);
        var invertedMatch = teamsMatch_(lev.strHomeTeam, awayTeam) && teamsMatch_(lev.strAwayTeam, homeTeam);
        if ((normalMatch || invertedMatch) && lev.intHomeScore !== null && lev.intHomeScore !== undefined && lev.intHomeScore !== '') {
          var hScore2 = parseInt(lev.intHomeScore, 10);
          var aScore2 = parseInt(lev.intAwayScore, 10);
          if (invertedMatch && !normalMatch) {
            var tmp2 = hScore2; hScore2 = aScore2; aScore2 = tmp2;
          }
          return {
            found: true,
            home: hScore2,
            away: aScore2,
            homeTeam: lev.strHomeTeam,
            awayTeam: lev.strAwayTeam,
            status: lev.strStatus || '',
            event: lev.strEvent || ''
          };
        }
      }
    }
  } catch (e) {
    // fallback silencioso
  }

  return { found: false };
}

/**
 * ===================================================================
 * SCRAPING AUTOMÁTICO DESDE EL SERVIDOR
 * Se ejecuta solo cada minuto via trigger de Apps Script.
 * No necesita que nadie tenga la web abierta.
 * ===================================================================
 */

/**
 * Comprueba si un partido está en ventana de scraping (30min antes a 3h después).
 */
function isLiveWindow_(kickoff) {
  if (!kickoff) return false;
  var now = new Date();
  var ko = new Date(kickoff);
  var start = new Date(ko.getTime() - 30 * 60 * 1000);
  var end = new Date(ko.getTime() + 250 * 60 * 1000);
  return now >= start && now <= end;
}

/**
 * Función principal de scraping automático.
 * Llamada cada minuto por el trigger de Apps Script.
 * Recorre todos los partidos, scrapea los que estén en ventana,
 * detecta goles, actualiza estado y envía notificaciones.
 * Usa Flashscore si el partido tiene flashscoreUrl configurada, si no TheSportsDB.
 */
function autoScrapeAll() {
  var state = getState_();
  if (!state || !state.matches || !state.matches.length) return;

  // Comprobar si hay algún partido pendiente o en juego
  var now = new Date();
  var anyAlive = false;
  var anyInWindow = false;

  for (var i = 0; i < state.matches.length; i++) {
    if (!state.matches[i].kickoff) continue;
    var ko = new Date(state.matches[i].kickoff);
    var end = new Date(ko.getTime() + 250 * 60 * 1000);
    if (now < end) anyAlive = true;
    if (isLiveWindow_(state.matches[i].kickoff)) anyInWindow = true;
  }

  // Si todos los partidos terminaron, borrar el trigger y salir
  if (!anyAlive) {
    deleteTrigger_();
    return;
  }

  // Si ningún partido está en ventana ahora, salir sin hacer nada (pero mantener trigger)
  if (!anyInWindow) return;

  // Scraping de partidos en ventana
  var prevScores = getPrevScores_();
  var stateChanged = false;

  for (var i = 0; i < state.matches.length; i++) {
    var match = state.matches[i];
    if (!match.homeTeam || !match.awayTeam) continue;
    if (!isLiveWindow_(match.kickoff)) continue;

    // Usar Flashscore si tiene URL configurada, si no TheSportsDB
    var result;
    if (match.flashscoreUrl) {
      result = scrapeFlashscore_(match.flashscoreUrl, match.homeTeam, match.awayTeam);
    } else {
      result = scrapeScores_(match.homeTeam, match.awayTeam);
    }
    if (!result.found) continue;

    var matchKey = match.flashscoreUrl
      ? 'fs_' + (match.flashscoreUrl.split('mid=')[1] || match.flashscoreUrl.slice(-20))
      : match.homeTeam.toLowerCase() + '_vs_' + match.awayTeam.toLowerCase();
    var prev = prevScores[matchKey];

    // Actualizar resultado
    state.matches[i].result = { home: result.home, away: result.away };
    state.matches[i].source = 'scraping';
    state.matches[i].lastUpdated = new Date().toISOString();
    stateChanged = true;

    // Detección de gol
    if (prev && (prev.home !== result.home || prev.away !== result.away)) {
      var goalMsg = '⚽ *GOL en La Porra!*\n' + match.homeTeam + ' ' + result.home + ' - ' + result.away + ' ' + match.awayTeam;
      var counts = countAlive_(state, i);
      if (counts) {
        goalMsg += '\n🏆 Quedan *' + counts.alive + '/' + counts.total + '* supervivientes';
      }
      notifyAll_(goalMsg);
    }

    prevScores[matchKey] = { home: result.home, away: result.away };
  }

  if (stateChanged) {
    setState_(state);
    setPrevScores_(prevScores);
  }

  // Comprobar fases (inicio, descanso, final) y notificar
  checkMatchPhasesAndNotify_();
}

/**
 * Gestión inteligente del trigger de scraping.
 * - Se CREA automáticamente cuando hay partidos con kickoff programado que aún no han terminado.
 * - Se BORRA automáticamente cuando todos los partidos han terminado (pasada la ventana de 3h).
 * - Si no hay kickoffs configurados, no se crea trigger.
 */
function hasTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoScrapeAll') return true;
  }
  return false;
}

function createTrigger_() {
  if (hasTrigger_()) return;
  try {
    ScriptApp.newTrigger('autoScrapeAll')
      .timeBased()
      .everyMinutes(1)
      .create();
  } catch (e) {}
}

function deleteTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoScrapeAll') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Analiza los partidos y decide si el trigger debe existir o no.
 * - Algún partido empieza en menos de 30 min o está en juego → activar
 * - Todos los partidos terminaron (pasaron 3h desde kickoff) → desactivar
 * - No hay kickoffs → no hacer nada
 */
function syncTriggerWithMatches_() {
  var state = getState_();
  if (!state.matches || !state.matches.length) return;

  var now = new Date();
  var hasUpcomingOrLive = false;

  for (var i = 0; i < state.matches.length; i++) {
    var match = state.matches[i];
    if (!match.kickoff) continue;
    var ko = new Date(match.kickoff);
    var end = new Date(ko.getTime() + 250 * 60 * 1000); // 3h después
    if (now < end) {
      // Este partido aún no ha terminado (o ni ha empezado)
      hasUpcomingOrLive = true;
      break;
    }
  }

  if (hasUpcomingOrLive) {
    createTrigger_();
  } else {
    deleteTrigger_();
  }
}

// ===================================================================

/**
 * Scraping de Flashscore: extrae el marcador del HTML sin renderizar JavaScript.
 * Los scores están en window.environment.common_feed: DE = goles local, DF = goles visitante.
 * eventStageId: 1 = pre-partido, 2 = en juego, 3 = finalizado.
 */
function scrapeFlashscore_(fsUrl, appHome, appAway) {
  try {
    var response = UrlFetchApp.fetch(fsUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-ES,es;q=0.9'
      }
    });
    var html = response.getContentText();

    var stageMatch = html.match(/"eventStageId"\s*:\s*(\d+)/);
    var eventStageId = stageMatch ? parseInt(stageMatch[1], 10) : 0;

    // DE = goles equipo local Flashscore, DF = goles visitante Flashscore
    var deMatch = html.match(/"DE"\s*:\s*"(\d+)"/);
    var dfMatch = html.match(/"DF"\s*:\s*"(\d+)"/);

    if (!deMatch || !dfMatch) {
      return { found: false, reason: eventStageId === 1 ? 'pre-match' : 'no-scores' };
    }

    var fsHome = parseInt(deMatch[1], 10);
    var fsAway = parseInt(dfMatch[1], 10);

    // Nombres de equipo en Flashscore
    var homeNameMatch = html.match(/"home"\s*:\s*\[\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    var awayNameMatch = html.match(/"away"\s*:\s*\[\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    var fsHomeName = homeNameMatch ? homeNameMatch[1] : '';
    var fsAwayName = awayNameMatch ? awayNameMatch[1] : '';

    // Mapear: si el local de Flashscore coincide con el visitante de nuestra app, invertir
    var swapped = false;
    if (appHome && appAway && fsHomeName && fsAwayName) {
      var homeMatchesHome = teamsMatch_(fsHomeName, appHome);
      var homeMatchesAway = teamsMatch_(fsHomeName, appAway);
      if (!homeMatchesHome && homeMatchesAway) {
        swapped = true;
      }
    }

    return {
      found: true,
      home: swapped ? fsAway : fsHome,
      away: swapped ? fsHome : fsAway,
      homeTeam: swapped ? fsAwayName : fsHomeName,
      awayTeam: swapped ? fsHomeName : fsAwayName,
      eventStageId: eventStageId,
      status: eventStageId === 3 ? 'Finalizado' : (eventStageId === 1 ? 'No comenzado' : 'En juego')
    };
  } catch (e) {
    return { found: false, error: String(e) };
  }
}
function doGet(e) {
  // Auto-setup: asegurar que el trigger de scraping existe (se crea solo la primera vez)
  syncTriggerWithMatches_();
  var action = (e && e.parameter && e.parameter.action) || 'getState';

  if (action === 'getState') {
    return toJsonResponse({ ok: true, state: getState_() });
  }

  // Proxy de scraping: el frontend llama con action=scrapeScores&home=...&away=...
  if (action === 'scrapeScores') {
    var home = (e.parameter && e.parameter.home) || '';
    var away = (e.parameter && e.parameter.away) || '';
    if (!home || !away) {
      return toJsonResponse({ ok: false, error: 'Faltan parámetros home/away' });
    }
    var result = scrapeScores_(home, away);

    // Detección de gol: comparar con marcador anterior y enviar notificaciones
    if (result.found) {
      var prevScores = getPrevScores_();
      var matchKey = home.toLowerCase() + '_vs_' + away.toLowerCase();
      var prev = prevScores[matchKey];

      // Actualizar el estado con el marcador actual ANTES de comprobar fases/goles
      var state = getState_();
      var matchIdx = -1;
      for (var mi = 0; mi < state.matches.length; mi++) {
        if (state.matches[mi].homeTeam.toLowerCase() === home.toLowerCase()) { matchIdx = mi; break; }
      }
      if (matchIdx >= 0) {
        state.matches[matchIdx].result = { home: result.home, away: result.away };
        state.matches[matchIdx].source = 'scraping';
        state.matches[matchIdx].lastUpdated = new Date().toISOString();
        setState_(state);
      }

      if (prev && (prev.home !== result.home || prev.away !== result.away)) {
        var goalMsg = '⚽ *GOL en La Porra!*\n' + home + ' ' + result.home + ' - ' + result.away + ' ' + away;

        if (matchIdx >= 0) {
          var counts = countAlive_(state, matchIdx);
          if (counts) {
            goalMsg += '\n🏆 Quedan *' + counts.alive + '/' + counts.total + '* supervivientes';
          }
        }

        notifyAll_(goalMsg);
      }
      prevScores[matchKey] = { home: result.home, away: result.away };
      setPrevScores_(prevScores);
    }

    // Comprobar fases del partido y notificar (con estado ya actualizado)
    checkMatchPhasesAndNotify_();

    return toJsonResponse({ ok: true, result: result });
  }

  // Scraping Flashscore: el frontend llama con action=scrapeFlashscore&url=...&appHome=...&appAway=...
  if (action === 'scrapeFlashscore') {
    var fsUrl = (e.parameter && e.parameter.url) || '';
    var appHome = (e.parameter && e.parameter.appHome) || '';
    var appAway = (e.parameter && e.parameter.appAway) || '';
    if (!fsUrl) {
      return toJsonResponse({ ok: false, error: 'Falta parámetro url' });
    }
    var result = scrapeFlashscore_(fsUrl, appHome, appAway);

    // Detección de gol y notificaciones (misma lógica que scrapeScores)
    if (result.found) {
      var prevScores = getPrevScores_();
      var matchKey = 'fs_' + fsUrl.split('mid=')[1] || fsUrl.slice(-20);
      var prev = prevScores[matchKey];
      if (prev && (prev.home !== result.home || prev.away !== result.away)) {
        var goalMsg = '⚽ *GOL en La Porra!*\n' + (appHome || result.homeTeam) + ' ' + result.home + ' - ' + result.away + ' ' + (appAway || result.awayTeam);

        var state = getState_();
        for (var mi = 0; mi < state.matches.length; mi++) {
          if (state.matches[mi].flashscoreUrl === fsUrl) {
            state.matches[mi].result = { home: result.home, away: result.away };
            var counts = countAlive_(state, mi);
            if (counts) {
              goalMsg += '\n🏆 Quedan *' + counts.alive + '/' + counts.total + '* supervivientes';
            }
            break;
          }
        }
        notifyAll_(goalMsg);
      }
      prevScores[matchKey] = { home: result.home, away: result.away };
      setPrevScores_(prevScores);
    }

    checkMatchPhasesAndNotify_();
    return toJsonResponse({ ok: true, result: result });
  }

  // Configuración WhatsApp
  if (action === 'getWhatsAppConfig') {
    return toJsonResponse({ ok: true, config: getWhatsAppConfig_() });
  }

  // Configuración Telegram
  if (action === 'getTelegramConfig') {
    return toJsonResponse({ ok: true, config: getTelegramConfig_() });
  }

  return toJsonResponse({ ok: false, error: 'Unknown action' });
}

/**
 * Actualiza un solo participante de forma atómica en el servidor.
 * Usa LockService para evitar race conditions entre dos usuarios simultáneos.
 */
function updateParticipant_(participant) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // espera hasta 10s
  try {
    var state = getState_();
    var participants = state.participants || [];
    var idx = -1;

    // Buscar por id primero, luego por nombre
    for (var i = 0; i < participants.length; i++) {
      if (participants[i].id === participant.id) { idx = i; break; }
    }
    if (idx < 0) {
      var nameLower = (participant.name || '').trim().toLowerCase();
      for (var i = 0; i < participants.length; i++) {
        if ((participants[i].name || '').trim().toLowerCase() === nameLower) { idx = i; break; }
      }
    }

    if (idx >= 0) {
      // Merge: respetar locked del servidor
      var existing = participants[idx];
      var exPreds = existing.predictions || [{home:null,away:null},{home:null,away:null},{home:null,away:null}];
      var exLocks = existing.locked || [false, false, false];
      var newPreds = participant.predictions || [{home:null,away:null},{home:null,away:null},{home:null,away:null}];
      var newLocks = participant.locked || [false, false, false];
      var mergedPreds = [];
      var mergedLocks = [];
      for (var i = 0; i < 3; i++) {
        if (exLocks[i]) {
          mergedPreds.push(exPreds[i]);
          mergedLocks.push(true);
        } else {
          mergedPreds.push(newPreds[i] || {home:null,away:null});
          mergedLocks.push(newLocks[i] || false);
        }
      }
      participants[idx] = {
        id: existing.id,
        name: existing.name,
        predictions: mergedPreds,
        locked: mergedLocks
      };
    } else {
      // Nuevo participante
      participants.push(participant);
    }

    state.participants = participants;
    setState_(state);
    return { ok: true, participant: participants[idx >= 0 ? idx : participants.length - 1] };
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  syncTriggerWithMatches_();
  try {
    const params = (e && e.parameter) || {};
    let action = params.action || '';
    let state = null;
    let participant = null;

    let waConfig = null;
    let tgConfig = null;

    // Accept simple form posts (no CORS preflight) and raw JSON posts.
    if (!action && e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents || '{}');
      action = body.action || '';
      state = body.state || null;
      participant = body.participant || null;
      waConfig = body.waConfig || null;
      tgConfig = body.tgConfig || null;
    } else if (params.state) {
      state = JSON.parse(params.state);
    }

    if (action === 'setState') {
      setState_(state);
      // Si todos los resultados están vacíos (reset jornada), limpiar fases y scores previos
      if (state && state.matches) {
        var allEmpty = state.matches.every(function(m) {
          return !m.result || m.result.home === null || m.result.home === undefined;
        });
        if (allEmpty) {
          setMatchPhases_({});
          setPrevScores_({});
        }
      }
      return toJsonResponse({ ok: true });
    }

    if (action === 'updateParticipant') {
      if (!participant) return toJsonResponse({ ok: false, error: 'Falta participant' });
      var result = updateParticipant_(participant);
      return toJsonResponse(result);
    }

    if (action === 'setWhatsAppConfig') {
      if (!waConfig) return toJsonResponse({ ok: false, error: 'Falta waConfig' });
      setWhatsAppConfig_(waConfig);
      return toJsonResponse({ ok: true });
    }

    if (action === 'testWhatsApp') {
      sendWhatsApp_('🏆 Test La Porra de Supervivencia: ¡WhatsApp automático configurado correctamente!');
      return toJsonResponse({ ok: true });
    }

    if (action === 'setTelegramConfig') {
      if (!tgConfig) return toJsonResponse({ ok: false, error: 'Falta tgConfig' });
      setTelegramConfig_(tgConfig);
      return toJsonResponse({ ok: true });
    }

    if (action === 'testTelegram') {
      sendTelegram_('🏆 Test La Porra de Supervivencia: ¡Telegram configurado correctamente!');
      return toJsonResponse({ ok: true });
    }

    return toJsonResponse({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return toJsonResponse({ ok: false, error: String(error) });
  }
}
