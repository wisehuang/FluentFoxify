// Firefox: the promise-based browser.* namespace; Manifest V2 calls the toolbar button browserAction.
const api = typeof browser !== 'undefined' ? browser : chrome;
const action = api.action || api.browserAction;

document.addEventListener('DOMContentLoaded', async function() {
  const apiKeyContainer = document.getElementById('apiKeyContainer');
  const refineContainer = document.getElementById('refineContainer');
  const apiKeyInput = document.getElementById('apiKey');
  const openaiModelInput = document.getElementById('openaiModel');
  const reasoningEffortSelect = document.getElementById('reasoningEffort');
  const autoCopyInput = document.getElementById('autoCopy');
  const closeAfterCopyInput = document.getElementById('closeAfterCopy');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const apiKeyStatus = document.getElementById('apiKeyStatus');
  const customToneList = document.getElementById('customToneList');
  const customToneLabel = document.getElementById('customToneLabel');
  const customToneStyle = document.getElementById('customToneStyle');
  const addCustomToneButton = document.getElementById('addCustomTone');
  const customToneStatus = document.getElementById('customToneStatus');
  const inputText = document.getElementById('inputText');
  const clearButton = document.getElementById('clearButton');
  const refineButton = document.getElementById('refineButton');
  const chat = document.getElementById('chat');
  const tones = document.getElementById('tones');
  const title = document.getElementById('title');
  const showSettings = document.getElementById('showSettings');
  const backButton = document.getElementById('backButton');

  let currentTone = DEFAULT_TONE;
  let customTones = [];
  let prefs = { autoCopy: false, closeAfterCopy: true };
  let hasApiKey = false;
  let busy = false;
  let hasOutput = false;
  let showChanges = true;
  let draftTimer = null;
  // The result on screen, restored if a request is cancelled.
  let currentResult = null;
  // Copies the result on screen; null when there is none.
  let copyCurrent = null;

  // ---------- storage ----------

  // The key lives in storage.local. Older versions kept it in storage.sync,
  // so move it over once and remove the synced copy.
  async function loadSettings() {
    const local = await api.storage.local.get([
      'openaiApiKey', 'openaiModel', 'reasoningEffort', 'tone', 'customTones', 'autoCopy', 'closeAfterCopy'
    ]);
    if (local.openaiApiKey) return local;

    // Firefox can have storage.sync disabled; then there is nothing to migrate.
    let synced;
    try {
      synced = await api.storage.sync.get(['openaiApiKey', 'openaiModel']);
    } catch (e) {
      return local;
    }
    if (!synced.openaiApiKey) return local;

    const migrated = {
      openaiApiKey: synced.openaiApiKey,
      openaiModel: synced.openaiModel || DEFAULT_MODEL
    };
    await api.storage.local.set(migrated);
    await api.storage.sync.remove(['openaiApiKey', 'openaiModel']);
    return { ...local, ...migrated };
  }

  function readPrefs(settings) {
    return {
      autoCopy: settings.autoCopy === true,
      closeAfterCopy: settings.closeAfterCopy !== false
    };
  }

  // ---------- views ----------

  function showView(view) {
    const settings = view === 'settings';
    apiKeyContainer.hidden = !settings;
    refineContainer.hidden = settings;
    title.textContent = settings ? 'Settings' : 'FluentFoxify';
    showSettings.hidden = settings;
    backButton.hidden = !(settings && hasApiKey);
    if (!settings) inputText.focus();
  }

  function setStatus(node, message, ok) {
    node.textContent = message;
    node.className = `status ${ok ? 'ok' : 'bad'}`;
  }

  // ---------- tone chips ----------

  function renderTones() {
    tones.replaceChildren();
    for (const [key, tone] of Object.entries(toneTable(customTones))) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tone';
      chip.textContent = tone.label;
      chip.title = tone.label;
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(key === currentTone));
      chip.disabled = busy;
      chip.addEventListener('click', function() {
        if (key === currentTone) return;
        currentTone = key;
        api.storage.local.set({ tone: key });
        renderTones();
        // A result is already on screen: redo it in the new tone.
        if (hasOutput && inputText.value.trim()) enhance();
      });
      tones.appendChild(chip);
    }
  }

  // ---------- result rendering ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text) {
    const node = el('button', className, text);
    node.type = 'button';
    return node;
  }

  // Rewrite with added words in <mark> and words dropped from the source in <del>.
  function highlighted(source, rewrite) {
    const fragment = document.createDocumentFragment();
    const tokens = diffWords(source, rewrite);
    let lastWasWord = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token.removed) {
        fragment.appendChild(token.changed ? el('mark', '', token.text) : document.createTextNode(token.text));
        lastWasWord = /\S/.test(token.text);
        continue;
      }
      const words = [token.text];
      while (i + 1 < tokens.length && tokens[i + 1].removed) {
        words.push(tokens[++i].text);
      }
      if (lastWasWord) fragment.appendChild(document.createTextNode(' '));
      fragment.appendChild(el('del', '', words.join(' ')));
      if (i + 1 < tokens.length) fragment.appendChild(document.createTextNode(' '));
      lastWasWord = false;
    }
    return fragment;
  }

  function renderEmpty() {
    hasOutput = false;
    copyCurrent = null;
    chat.replaceChildren(el('div', 'system', 'Type a sentence, pick a tone, and send.'));
  }

  function renderLoading() {
    copyCurrent = null;
    const dots = el('span', 'typing');
    dots.append(el('i'), el('i'), el('i'));
    const cancel = button('secondary', 'Cancel');
    cancel.addEventListener('click', function() {
      cancel.disabled = true;
      sendToBackground({ action: 'cancelRefine' });
    });
    const card = el('div', 'card');
    card.append(dots, cancel);
    chat.replaceChildren(card);
  }

  function renderError(message) {
    hasOutput = true;
    copyCurrent = null;
    chat.replaceChildren(el('div', 'card error', message));
  }

  function renderResult(data) {
    hasOutput = true;
    currentResult = data;
    const source = typeof data.source === 'string' ? data.source : '';
    const card = el('div', 'card');

    const head = el('div', 'card-head');
    const toneLabel = data.toneLabel || toneTable(customTones)[resolveTone(data.tone, customTones)].label;
    head.appendChild(el('span', 'tone-tag', toneLabel));
    // A Chinese source is translated, so there is no word diff to show.
    const translated = containsChinese(source);
    const toggle = button('toggle', 'Changes');
    if (translated) {
      head.appendChild(el('span', 'tone-tag', 'Translated'));
    } else {
      head.appendChild(toggle);
    }

    const body = el('div', 'result');
    function paint() {
      toggle.setAttribute('aria-pressed', String(showChanges));
      const diff = showChanges && !translated;
      body.replaceChildren(diff ? highlighted(source, data.text) : document.createTextNode(data.text));
    }
    toggle.addEventListener('click', function() {
      showChanges = !showChanges;
      paint();
    });
    paint();
    card.append(head, body);

    // The rewrite translated back into Chinese, so the writer can check the meaning.
    if (data.meaning) {
      const meaning = el('p', 'meaning');
      meaning.append(el('span', 'meaning-label', 'Meaning'), document.createTextNode(data.meaning));
      card.appendChild(meaning);
    }
    if (data.note) card.appendChild(el('p', 'note', data.note));

    const retry = button('secondary', 'Retry');
    // Retry the text and tone this result came from, even if the draft has changed since.
    retry.addEventListener('click', function() {
      enhance({ text: source, tone: data.tone });
    });
    const copy = button('primary', 'Copy');
    let resetTimer = null;
    async function doCopy({ auto = false } = {}) {
      clearTimeout(resetTimer);
      try {
        await navigator.clipboard.writeText(data.text);
      } catch (e) {
        copy.textContent = 'Copy failed';
        return;
      }
      copy.textContent = 'Copied';
      // Only an explicit copy closes the popup; an automatic one keeps the result visible.
      if (!auto && prefs.closeAfterCopy) {
        setTimeout(function() { window.close(); }, 300);
        return;
      }
      resetTimer = setTimeout(function() { copy.textContent = 'Copy'; }, 1500);
    }
    copy.addEventListener('click', function() { doCopy(); });
    copyCurrent = doCopy;

    const actions = el('div', 'actions');
    actions.append(retry, copy);
    card.appendChild(actions);
    chat.replaceChildren(card);
    chat.scrollTop = 0;
    return copy;
  }

  // ---------- composer ----------

  function autosize() {
    inputText.style.height = 'auto';
    inputText.style.height = `${Math.min(inputText.scrollHeight + 2, 160)}px`;
  }

  function updateClear() {
    clearButton.hidden = !inputText.value && !currentResult;
    clearButton.disabled = busy;
  }

  function setBusy(value) {
    busy = value;
    refineButton.disabled = value;
    updateClear();
    renderTones();
  }

  async function sendToBackground(message) {
    try {
      return await api.runtime.sendMessage(message);
    } catch (e) {
      return { success: false, error: `Runtime error: ${e.message}` };
    }
  }

  // Uses the draft and the selected tone unless Retry passes the ones a result came from.
  async function enhance(retry) {
    if (busy) return;
    const text = (retry ? retry.text : inputText.value).trim();
    const tone = retry ? resolveTone(retry.tone, customTones) : currentTone;
    if (!text) {
      renderError('Please enter an English or Chinese sentence to enhance');
      return;
    }

    // Mark busy before the first await so a double click or two quick tone picks cannot start two requests.
    setBusy(true);
    let settings;
    try {
      settings = await loadSettings();
    } catch (e) {
      setBusy(false);
      renderError(`Could not read settings: ${e.message}`);
      return;
    }
    if (!settings.openaiApiKey) {
      setBusy(false);
      renderError('API key not set, please configure settings first');
      updateClear();
      return;
    }

    renderLoading();
    const response = await sendToBackground({
      action: 'refineText',
      text: text,
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel || DEFAULT_MODEL,
      reasoningEffort: resolveReasoningEffort(settings.reasoningEffort),
      tone: tone,
      customTones: customTones
    });
    setBusy(false);

    if (response && response.success) {
      const copy = renderResult(response);
      copy.focus();
      if (prefs.autoCopy) copyCurrent({ auto: true });
    } else if (response && response.cancelled) {
      if (currentResult) {
        renderResult(currentResult);
      } else {
        renderEmpty();
      }
    } else if (response && response.error) {
      renderError(response.error.startsWith('Runtime error') ? response.error : `Error: ${response.error}`);
    } else {
      renderError('Unable to connect to API. Check your network connection and API key.');
    }
    updateClear();
  }

  refineButton.addEventListener('click', function() { enhance(); });

  inputText.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      enhance();
    }
  });

  inputText.addEventListener('input', function() {
    autosize();
    updateClear();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function() {
      api.storage.session.set({ draft: inputText.value });
    }, 300);
  });

  clearButton.addEventListener('click', function() {
    if (busy) return;
    clearTimeout(draftTimer);
    inputText.value = '';
    currentResult = null;
    api.storage.session.remove(['draft', 'lastResult']);
    renderEmpty();
    autosize();
    updateClear();
    inputText.focus();
  });

  // Ctrl/Cmd+C copies the result unless the user has text selected to copy instead.
  document.addEventListener('keydown', function(e) {
    if (!copyCurrent || refineContainer.hidden) return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'c') return;
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      if (active.selectionStart !== active.selectionEnd) return;
    } else if (String(window.getSelection())) {
      return;
    }
    e.preventDefault();
    copyCurrent();
  });

  // ---------- settings ----------

  saveApiKeyButton.addEventListener('click', async function() {
    const apiKey = apiKeyInput.value.trim();
    const openaiModel = openaiModelInput.value.trim() || DEFAULT_MODEL;

    if (!apiKey) {
      setStatus(apiKeyStatus, 'Please enter a valid API key', false);
      return;
    }
    if (!apiKey.startsWith('sk-')) {
      setStatus(apiKeyStatus, 'Invalid API key format, should start with sk-', false);
      return;
    }

    prefs = { autoCopy: autoCopyInput.checked, closeAfterCopy: closeAfterCopyInput.checked };
    await api.storage.local.set({
      openaiApiKey: apiKey,
      openaiModel: openaiModel,
      reasoningEffort: resolveReasoningEffort(reasoningEffortSelect.value),
      autoCopy: prefs.autoCopy,
      closeAfterCopy: prefs.closeAfterCopy
    });
    hasApiKey = true;
    setStatus(apiKeyStatus, 'Saved', true);
    setTimeout(function() {
      setStatus(apiKeyStatus, '', true);
      showView('chat');
    }, 600);
  });

  // ---------- custom tones ----------

  function renderCustomTones() {
    customToneList.replaceChildren();
    for (const tone of customTones) {
      const item = el('li');
      const text = el('span', 'tone-text', tone.label);
      text.appendChild(el('span', 'tone-style', tone.style));
      const remove = button('remove', 'Delete');
      remove.setAttribute('aria-label', `Delete ${tone.label}`);
      remove.addEventListener('click', function() {
        saveCustomTones(customTones.filter(t => t.id !== tone.id));
      });
      item.append(text, remove);
      customToneList.appendChild(item);
    }
    addCustomToneButton.disabled = customTones.length >= MAX_CUSTOM_TONES;
  }

  // Saved right away, separately from the Save button, so tones work before a key is set.
  async function saveCustomTones(list) {
    customTones = normalizeCustomTones(list);
    const update = { customTones };
    // The selected tone was deleted: fall back to the default.
    if (resolveTone(currentTone, customTones) !== currentTone) {
      currentTone = DEFAULT_TONE;
      update.tone = currentTone;
    }
    await api.storage.local.set(update);
    renderCustomTones();
    renderTones();
  }

  addCustomToneButton.addEventListener('click', async function() {
    const label = customToneLabel.value.trim();
    const style = customToneStyle.value.trim();
    if (!label || !style) {
      setStatus(customToneStatus, 'Enter a name and a description', false);
      return;
    }
    if (customTones.length >= MAX_CUSTOM_TONES) {
      setStatus(customToneStatus, `Up to ${MAX_CUSTOM_TONES} custom tones`, false);
      return;
    }
    const id = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await saveCustomTones([...customTones, { id, label, style }]);
    customToneLabel.value = '';
    customToneStyle.value = '';
    setStatus(customToneStatus, `Added "${label}"`, true);
  });

  showSettings.addEventListener('click', async function() {
    const settings = await loadSettings();
    apiKeyInput.value = settings.openaiApiKey || '';
    openaiModelInput.value = settings.openaiModel || DEFAULT_MODEL;
    reasoningEffortSelect.value = resolveReasoningEffort(settings.reasoningEffort);
    prefs = readPrefs(settings);
    autoCopyInput.checked = prefs.autoCopy;
    closeAfterCopyInput.checked = prefs.closeAfterCopy;
    setStatus(customToneStatus, '', true);
    showView('settings');
  });

  backButton.addEventListener('click', function() {
    showView('chat');
  });

  // ---------- startup ----------

  action.setBadgeText({ text: '' });

  const settings = await loadSettings();
  const session = await api.storage.session.get(['draft', 'lastResult']);
  // Text sent by the "Enhance with FluentFoxify" context menu item, if any.
  const fromMenu = await sendToBackground({ action: 'takeSelection' });
  const menuText = fromMenu && typeof fromMenu.text === 'string' ? fromMenu.text : '';

  hasApiKey = Boolean(settings.openaiApiKey);
  customTones = normalizeCustomTones(settings.customTones);
  currentTone = resolveTone(settings.tone, customTones);
  prefs = readPrefs(settings);
  openaiModelInput.value = settings.openaiModel || DEFAULT_MODEL;
  for (const effort of REASONING_EFFORTS) {
    reasoningEffortSelect.appendChild(new Option(effort, effort));
  }
  reasoningEffortSelect.value = resolveReasoningEffort(settings.reasoningEffort);
  autoCopyInput.checked = prefs.autoCopy;
  closeAfterCopyInput.checked = prefs.closeAfterCopy;
  customToneLabel.maxLength = CUSTOM_TONE_LABEL_MAX;
  customToneStyle.maxLength = CUSTOM_TONE_STYLE_MAX;
  renderTones();
  renderCustomTones();

  inputText.value = menuText || session.draft || '';
  if (session.lastResult && typeof session.lastResult.text === 'string') {
    renderResult(session.lastResult);
  } else {
    renderEmpty();
  }

  showView(hasApiKey ? 'chat' : 'settings');
  autosize();
  updateClear();

  if (menuText) {
    await api.storage.session.set({ draft: menuText });
    if (hasApiKey) enhance();
  }
});
