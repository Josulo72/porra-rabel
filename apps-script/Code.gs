const KEY = 'PORRA_SHARED_STATE_V1';

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
 * Proxy de scraping: llama a TheSportsDB desde el servidor de Google
 * para evitar bloqueos CORS del navegador.
 * Busca el partido por nombre de equipo y devuelve el marcador si existe.
 */
function scrapeScores_(homeTeam, awayTeam) {
  const queries = [
    homeTeam + ' vs ' + awayTeam,
    awayTeam + ' vs ' + homeTeam,
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
      var homeLower = homeTeam.toLowerCase();
      var awayLower = awayTeam.toLowerCase();

      // Buscar el evento que mejor coincida
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var evHome = (ev.strHomeTeam || '').toLowerCase();
        var evAway = (ev.strAwayTeam || '').toLowerCase();
        var homeMatch = evHome.indexOf(homeLower.split(' ')[0]) >= 0 || homeLower.indexOf(evHome.split(' ')[0]) >= 0;
        var awayMatch = evAway.indexOf(awayLower.split(' ')[0]) >= 0 || awayLower.indexOf(evAway.split(' ')[0]) >= 0;
        if (homeMatch && awayMatch && ev.intHomeScore !== null && ev.intHomeScore !== undefined && ev.intHomeScore !== '') {
          return {
            found: true,
            home: parseInt(ev.intHomeScore, 10),
            away: parseInt(ev.intAwayScore, 10),
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
    return toJsonResponse({ ok: true, result: result });
  }

  return toJsonResponse({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    let action = params.action || '';
    let state = null;

    // Accept simple form posts (no CORS preflight) and raw JSON posts.
    if (!action && e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents || '{}');
      action = body.action || '';
      state = body.state || null;
    } else if (params.state) {
      state = JSON.parse(params.state);
    }

    if (action === 'setState') {
      setState_(state);
      return toJsonResponse({ ok: true });
    }
    return toJsonResponse({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return toJsonResponse({ ok: false, error: String(error) });
  }
}
