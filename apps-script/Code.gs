const KEY = 'PORRA_SHARED_STATE_V1';
const WHATSAPP_CONFIG_KEY = 'PORRA_WHATSAPP_CONFIG';
const PREV_SCORES_KEY = 'PORRA_PREV_SCORES';

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
        if (teamsMatch_(lev.strAwayTeam, awayTeam) || teamsMatch_(lev.strHomeTeam, awayTeam)) {
          if (lev.intHomeScore !== null && lev.intHomeScore !== undefined && lev.intHomeScore !== '') {
            return {
              found: true,
              home: parseInt(lev.intHomeScore, 10),
              away: parseInt(lev.intAwayScore, 10),
              homeTeam: lev.strHomeTeam,
              awayTeam: lev.strAwayTeam,
              status: lev.strStatus || '',
              event: lev.strEvent || ''
            };
          }
        }
      }
    }
  } catch (e) {
    // fallback silencioso
  }

  return { found: false };
}

function doGet(e) {
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

    // Detección de gol: comparar con marcador anterior y enviar WhatsApp
    if (result.found) {
      var prevScores = getPrevScores_();
      var matchKey = home.toLowerCase() + '_vs_' + away.toLowerCase();
      var prev = prevScores[matchKey];
      if (prev && (prev.home !== result.home || prev.away !== result.away)) {
        // ¡Gol detectado! Enviar WhatsApp
        var goalMsg = '⚽ *GOL en La Porra!*\n' + home + ' ' + result.home + ' - ' + result.away + ' ' + away;

        // Comprobar eliminados
        var state = getState_();
        var eliminated = [];
        if (state.participants && state.participants.length) {
          var matchIdx = -1;
          for (var mi = 0; mi < state.matches.length; mi++) {
            if (state.matches[mi].homeTeam.toLowerCase() === home.toLowerCase()) { matchIdx = mi; break; }
          }
          if (matchIdx >= 0) {
            for (var pi = 0; pi < state.participants.length; pi++) {
              var p = state.participants[pi];
              var pred = p.predictions && p.predictions[matchIdx];
              if (pred && pred.home !== null && pred.away !== null) {
                if (Number(pred.home) !== result.home || Number(pred.away) !== result.away) {
                  eliminated.push(p.name);
                }
              }
            }
          }
        }
        if (eliminated.length) {
          goalMsg += '\n\n💀 *Eliminados (' + eliminated.length + '):* ' + eliminated.join(', ');
        }

        var aliveCount = (state.participants || []).length - eliminated.length;
        goalMsg += '\n🏆 Quedan *' + aliveCount + '* supervivientes';

        sendWhatsApp_(goalMsg);
      }
      prevScores[matchKey] = { home: result.home, away: result.away };
      setPrevScores_(prevScores);
    }

    return toJsonResponse({ ok: true, result: result });
  }

  // Configuración WhatsApp
  if (action === 'getWhatsAppConfig') {
    return toJsonResponse({ ok: true, config: getWhatsAppConfig_() });
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
  try {
    const params = (e && e.parameter) || {};
    let action = params.action || '';
    let state = null;
    let participant = null;

    let waConfig = null;

    // Accept simple form posts (no CORS preflight) and raw JSON posts.
    if (!action && e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents || '{}');
      action = body.action || '';
      state = body.state || null;
      participant = body.participant || null;
      waConfig = body.waConfig || null;
    } else if (params.state) {
      state = JSON.parse(params.state);
    }

    if (action === 'setState') {
      setState_(state);
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

    return toJsonResponse({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return toJsonResponse({ ok: false, error: String(error) });
  }
}
