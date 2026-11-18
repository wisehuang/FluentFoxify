// Firefox loads shared.js before this file (manifest background.scripts), so there is no importScripts.
const api = typeof browser !== 'undefined' ? browser : chrome;
// Manifest V2 exposes the toolbar button as browserAction.
const action = api.action || api.browserAction;

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MENU_ID = 'fluentify-enhance-selection';
// Sent by default, dropped one at a time if the chosen model rejects them.
const OPTIONAL_PARAMS = ['reasoning_effort', 'response_format'];
// High reasoning effort can be slow, so leave room before giving up.
const REQUEST_TIMEOUT_MS = 120000;

// The request in progress, so the popup can cancel it and a new request replaces it.
let inflight = null;

function abortError(message) {
  const error = new Error(message);
  error.cancelled = true;
  return error;
}

// Firefox does not keep menus made by a persistent background page across restarts,
// and onInstalled does not fire on startup, so create the menu every time this script loads.
api.contextMenus.removeAll().then(() => {
  api.contextMenus.create({
    id: MENU_ID,
    title: 'Enhance with FluentFoxify',
    contexts: ['selection']
  });
});

// Text picked from the context menu, waiting for the popup to take it (action 'takeSelection').
// Kept in memory, not storage.session: Firefox only allows openPopup() before the handler's
// first await, so a storage write could still be pending when the popup reads it.
let pendingSelection = null;

api.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText || '').trim();
  if (!text) return;

  pendingSelection = text;
  try {
    await action.openPopup();
  } catch (e) {
    // The popup could not be opened from here: flag the icon so the user clicks it.
    action.setBadgeBackgroundColor({ color: '#06C755' });
    action.setBadgeText({ text: '1' });
  }
});

async function callOpenAI(apiKey, body, signal) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = new Error(
      payload?.error?.message || `API responded with status ${response.status}: ${response.statusText}`
    );
    error.status = response.status;
    error.param = payload?.error?.param || '';
    throw error;
  }
  return response.json();
}

function rejectedParam(error, body) {
  if (error.status !== 400) return null;
  return OPTIONAL_PARAMS.find(name =>
    name in body && (String(error.param).startsWith(name) || error.message.includes(name))
  ) || null;
}

async function refineText({ text, apiKey, model, tone, customTones, reasoningEffort }, signal) {
  const body = {
    model: typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL,
    messages: buildMessages(text, tone, customTones),
    reasoning_effort: resolveReasoningEffort(reasoningEffort),
    response_format: { type: 'json_object' }
  };

  for (;;) {
    try {
      const data = await callOpenAI(apiKey, body, signal);
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('No completion choices returned from the API');
      }
      return parseResult(content);
    } catch (error) {
      const param = rejectedParam(error, body);
      if (!param) throw error;
      delete body[param];
    }
  }
}

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'takeSelection') {
    sendResponse({ text: pendingSelection });
    pendingSelection = null;
    return;
  }
  if (request.action === 'cancelRefine') {
    if (inflight) inflight.abort(abortError('Request cancelled'));
    sendResponse({ success: true });
    return;
  }
  if (request.action !== 'refineText') return;

  if (inflight) inflight.abort(abortError('Replaced by a newer request'));
  const controller = new AbortController();
  inflight = controller;
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`));
  }, REQUEST_TIMEOUT_MS);

  refineText(request, controller.signal)
    .then(async ({ text, note, meaning }) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const tone = resolveTone(request.tone, request.customTones);
      const lastResult = {
        source: request.text,
        tone,
        toneLabel: toneTable(request.customTones)[tone].label,
        text,
        note,
        meaning
      };
      // Stored here so the result survives the popup closing mid-request.
      await api.storage.session.set({ lastResult });
      sendResponse({ success: true, ...lastResult });
    })
    .catch(error => {
      // After an abort, report why (cancel, replaced, timeout) rather than the fetch error.
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      if (!reason?.cancelled) console.error('OpenAI API Error:', reason);
      sendResponse({
        success: false,
        cancelled: Boolean(reason?.cancelled),
        error: reason?.message || 'An unexpected error occurred'
      });
    })
    .finally(() => {
      clearTimeout(timer);
      if (inflight === controller) inflight = null;
    });

  // Return true to indicate that the response will be sent asynchronously
  return true;
});
