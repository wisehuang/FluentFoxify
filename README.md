# FluentFoxify

**FluentFoxify** is a Firefox extension that helps you enhance and refine your English sentences using OpenAI's GPT models. With a simple popup interface, you can enter your OpenAI API key and instantly get improved, more fluent English sentences.

---

## Features

- 🌏 **Chinese input:** Type Chinese and get it translated into English in the selected tone, in one request, with the English translated back into Chinese so you can check the meaning.
- ✨ **Refine English sentences:** Get one rewrite per sentence, with added words highlighted, removed words struck through, and a one-line note on what was fixed.
- 🎭 **Tones:** Neutral, Formal, Work chat, or Casual, plus up to 8 custom tones you describe in Settings. Your last choice is remembered.
- 📝 **Editor-style popup:** Type on top, read the rewrite in a full-width card below. Press Ctrl/⌘ + Enter to send; picking another tone redoes the rewrite.
- 🖱️ **Right-click menu:** Select text on any page and choose **Enhance with FluentFoxify**.
- 📋 **Copy to clipboard:** Click Copy, press Enter (Copy is focused after each result), or press Ctrl/⌘ + C. The popup closes after copying unless you turn that off in Settings; you can also have every result copied automatically.
- 🔁 **Retry, clear and cancel:** Retry asks for another rewrite in the same tone, the × button clears the draft and the result, and Cancel stops a slow request (requests also time out after 120 seconds).
- 💾 **Keeps your place:** The draft and the last result survive closing the popup, until the browser is closed.
- 🔑 **Local API key storage:** Your OpenAI API key is stored on this device only (`browser.storage.local`).
- ⚙️ **Settings panel:** Update your API key, model, reasoning effort, copy behavior and custom tones at any time.

---


## Installation

### 1. Clone

Clone this repository.

### 2. Load the Extension in Firefox

1. Open Firefox (140 or later) and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to the extension folder and select `manifest.json`
4. The extension stays loaded until Firefox is closed

---

## Usage

1. Click the FluentFoxify icon in your Firefox toolbar.
2. **First time:** Enter your OpenAI API key (starts with `sk-`) and save it.
3. Pick a tone and enter the English (or Chinese) sentence you want to enhance.
4. Click the send button or press Ctrl/⌘ + Enter. The rewrite appears in the card below; use **Changes** to switch between the marked-up and clean text, and **Retry** for another version.
5. Click **Copy** (or press Enter or Ctrl/⌘ + C). By default the popup closes after copying.

You can also select text on a web page, right-click, and choose **Enhance with FluentFoxify**. If the popup does not open by itself, click the FluentFoxify icon (it shows a badge).

---

## How It Works

- The extension stores your API key in Firefox's local extension storage.
- When you submit a sentence, the background script sends it to OpenAI's Chat Completions API with the prompt for the chosen tone.
- The rewrite is displayed in the popup, with words that differ from your original highlighted.

---

## Security & Privacy

- Your API key is only stored locally in your browser and is never shared with anyone except OpenAI.
- Only the text you submit (typed or selected with the right-click menu) is sent, directly to OpenAI with your own API key. The extension has no analytics or telemetry and sends nothing to anyone else.

---

## Requirements

- A valid [OpenAI API key](https://platform.openai.com/account/api-keys)
- Mozilla Firefox 140 or later (latest recommended)

---

## File Structure

```
FluentFoxify/
├── background.js      # background script: OpenAI calls, context menu
├── shared.js          # tones, prompt, reply parsing, word diff
├── manifest.json
├── popup.html
├── popup.js
├── tests/             # node --test
└── README.md
```

---

## Customization

- Built-in tones and the prompt live in `shared.js` (`TONES`, `buildMessages`); custom tones are added in Settings.
- The default model is `DEFAULT_MODEL` in `shared.js`; you can also set a model in Settings.
- To update the UI, modify `popup.html` and `popup.js`.
- Run the unit tests with `node --test`.

---

## License

MIT License

---

## Disclaimer

FluentFoxify is not affiliated with or endorsed by OpenAI. Use at your own risk and be mindful of your OpenAI API usage and associated costs.

---

## Credits

- [OpenAI](https://openai.com/) for the GPT API
- Firefox WebExtensions API

---

Enjoy writing fluently with **FluentFoxify**! 🚀
