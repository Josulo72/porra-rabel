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

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getState';
  if (action === 'getState') {
    return toJsonResponse({ ok: true, state: getState_() });
  }
  return toJsonResponse({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'setState') {
      setState_(body.state);
      return toJsonResponse({ ok: true });
    }
    return toJsonResponse({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return toJsonResponse({ ok: false, error: String(error) });
  }
}
