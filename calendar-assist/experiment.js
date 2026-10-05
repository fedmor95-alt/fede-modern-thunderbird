var {ExtensionCommon} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var {ExtensionSupport} = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const FM_LISTENER = "fede-calendar@local";
const FM_URLS = [
  "chrome://calendar/content/calendar-event-dialog.xhtml",
  "chrome://messenger/content/messenger.xhtml",
];
const FM_IFRAME = "chrome://calendar/content/calendar-item-iframe.xhtml";
const FM_HTML = "http://www.w3.org/1999/xhtml";
const FM_VIDEO_TOOLBARS = new WeakMap();

function fmMeetingUrl(url, win) {
  try {
    const parsed = new win.URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href.length > 2048) return null;
    if (parsed.hostname === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(parsed.pathname)) return parsed.href;
    if (parsed.hostname === "zoom.us" || parsed.hostname.endsWith(".zoom.us")) {
      if (/^\/(?:j|my)\/[A-Za-z0-9_-]+/.test(parsed.pathname)) return parsed.href;
    }
  } catch (_) { /* Invalid pasted links are ignored. */ }
  return null;
}

class FmEventEditor {
  constructor(frame) {
    this.frame = frame;
    this.win = frame.contentWindow;
    this.doc = frame.contentDocument;
    this.title = this.doc.getElementById("item-title");
    this.start = this.doc.getElementById("event-starttime");
    this.end = this.doc.getElementById("event-endtime");
    if (!this.title || !this.start || !this.end || !this.win.calendarItem?.isEvent?.()) return;
    this.active = true;
    this.initialStart = new Date(this.start.value);
    this.initialEnd = new Date(this.end.value);
    this.lastAutoStart = null;
    this.lastAutoEnd = null;
    this.manualDate = false;
    this.committed = false;
    this.onTitleInput = event => {
      if (!event.isTrusted || event.isComposing || this.win.mode !== "new") return;
      this.win.clearTimeout(this.delay);
      this.delay = this.win.setTimeout(() => this.updateSuggestion(), 120);
    };
    this.onTitleBlur = () => this.finalizeTitle();
    this.onDateChange = event => { if (event.isTrusted && !this.autoApplying) this.manualDate = true; };
    this.title.addEventListener("input", this.onTitleInput);
    this.title.addEventListener("blur", this.onTitleBlur);
    for (const node of [this.start, this.end]) {
      node.addEventListener("change", this.onDateChange, true);
      node.addEventListener("input", this.onDateChange, true);
    }
    this.onSave = event => {
      const current = this.frame.ownerDocument.getElementById("tabmail")?.currentTabInfo?.iframe;
      if (current && current !== this.frame) return;
      const command = event.target.getAttribute?.("command");
      if (["cmd_accept", "cmd_save", "button-saveandclose"].includes(event.target.id) || ["cmd_accept", "cmd_save"].includes(command)) this.finalizeTitle();
    };
    this.frame.ownerDocument.addEventListener("command", this.onSave, true);
    this.makeHint();
    this.attachVideoControl();
  }

  makeHint() {
    const box = this.title.parentElement;
    this.hint = this.doc.createElementNS(FM_HTML, "div");
    this.hint.id = "fm-calendar-title-hint";
    this.hint.setAttribute("role", "status");
    this.hint.hidden = true;
    box?.appendChild(this.hint);
  }

  showHint(message) {
    if (!this.hint) return;
    this.hint.textContent = message;
    this.hint.hidden = !message;
  }

  updateSuggestion() {
    if (!this.active || this.win.mode !== "new") return;
    const value = this.title.value;
    const result = parseTitle(value, new Date(), this.initialStart);
    this.suggestion = result ? {input: value, result} : null;
    if (!result) {
      this.showHint("");
      this.restoreInitialTime();
      return;
    }
    const when = new Intl.DateTimeFormat("it-IT", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}).format(result.start);
    this.showHint(this.manualDate ? `Data impostata manualmente · il titolo resta invariato` : `Data e ora: ${when}`);
    if (!this.manualDate) this.applyTime(result.start, result.end);
  }

  applyTime(start, end) {
    if (this.doc.getElementById("event-all-day")?.checked) return;
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
    this.autoApplying = true;
    try {
      this.start.value = start;
      this.start.dispatchEvent(new this.win.Event("change", {bubbles: true}));
      this.end.value = end;
      this.end.dispatchEvent(new this.win.Event("change", {bubbles: true}));
    } finally {
      this.autoApplying = false;
    }
    this.lastAutoStart = new Date(this.start.value);
    this.lastAutoEnd = new Date(this.end.value);
  }

  restoreInitialTime() {
    if (this.manualDate || this.committed || !this.lastAutoStart || !this.lastAutoEnd) return;
    if (+new Date(this.start.value) !== +this.lastAutoStart || +new Date(this.end.value) !== +this.lastAutoEnd) return;
    this.applyTime(this.initialStart, this.initialEnd);
    this.lastAutoStart = this.lastAutoEnd = null;
  }

  finalizeTitle() {
    this.win.clearTimeout(this.delay);
    if (!this.active || this.win.mode !== "new") return;
    this.updateSuggestion();
    const {input, result} = this.suggestion || {};
    if (!result || this.title.value !== input || this.manualDate || this.doc.getElementById("event-all-day")?.checked) return;
    let clean = result.title;
    if (result.person) {
      const node = this.doc.getElementById("item-description");
      try {
        const editor = node?.getHTMLEditor(node.contentWindow);
        if (!editor?.rootElement?.textContent?.trim()) {
          editor.insertText(`Con ${result.person}`);
        } else {
          clean += ` con ${result.person}`;
        }
      } catch (_) { clean += ` con ${result.person}`; }
    }
    this.title.value = clean;
    this.title.dispatchEvent(new this.win.Event("input", {bubbles: true}));
    this.committed = true;
    this.showHint("");
    this.suggestion = null;
  }

  existingLink() {
    const location = this.doc.getElementById("item-location")?.value || "";
    const match = /(https:\/\/[^\s<>"']+)/.exec(location);
    const fromLocation = match && fmMeetingUrl(match[1], this.win);
    if (fromLocation) return fromLocation;
    for (const item of this.doc.querySelectorAll("#attachment-link richlistitem")) {
      const url = fmMeetingUrl(item.attachment?.uri?.spec, this.win);
      if (url) return url;
    }
    return null;
  }

  attachVideoControl() {
    const outer = this.frame.ownerDocument;
    const toolbar = outer.getElementById("event-toolbar") || outer.getElementById("event-tab-toolbar");
    if (!toolbar) return;
    const previous = FM_VIDEO_TOOLBARS.get(outer);
    if (previous) {
      previous.editors.add(this);
      this.videoState = previous;
      return;
    }
    const state = {editors: new Set([this])};
    this.videoState = state;
    FM_VIDEO_TOOLBARS.set(outer, state);
    const current = () => {
      const frame = outer.getElementById("tabmail")?.currentTabInfo?.iframe;
      if (frame) return [...state.editors].find(editor => editor.frame === frame) || null;
      return [...state.editors][0] || null;
    };
    const button = outer.createXULElement("toolbarbutton");
    state.button = button;
    button.id = "fm-video-button";
    button.className = "toolbarbutton-1";
    button.setAttribute("type", "menu");
    button.setAttribute("label", "Videoconferenza");
    button.setAttribute("tooltiptext", "Aggiungi o apri una videoconferenza");
    const menu = outer.createXULElement("menupopup");
    for (const [url, label] of [["https://meet.google.com/", "Crea in Google Meet…"], ["https://zoom.us/meeting", "Programma in Zoom…"]]) {
      const item = outer.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.addEventListener("command", event => {
        if (!event.isTrusted) return;
        current()?.win.openLinkExternally(url);
        current()?.showHint("Copia il link video, poi scegli “Aggiungi link” qui.");
      });
      menu.appendChild(item);
    }
    const add = outer.createXULElement("menuitem");
    add.setAttribute("label", "Aggiungi link Meet o Zoom…");
    add.addEventListener("command", event => { if (event.isTrusted) current()?.promptLink(); });
    menu.appendChild(add);
    const join = outer.createXULElement("menuitem");
    join.setAttribute("label", "Partecipa");
    join.addEventListener("command", event => {
      if (!event.isTrusted) return;
      const url = current()?.existingLink();
      if (url) current()?.win.openLinkExternally(url);
    });
    menu.appendChild(outer.createXULElement("menuseparator"));
    menu.appendChild(join);
    menu.addEventListener("popupshowing", () => { join.hidden = !current()?.existingLink(); });
    button.appendChild(menu);
    toolbar.appendChild(button);
  }

  promptLink() {
    const value = {value: "https://"};
    if (!Services.prompt.prompt(this.win, "Videoconferenza", "Incolla il link Google Meet o Zoom", value, null, {value: 0})) return;
    const safe = fmMeetingUrl(value.value.trim(), this.win);
    if (!safe) { this.showHint("Inserisci un link Meet o Zoom valido, in HTTPS."); return; }
    if (this.existingLink()) { this.showHint("L'evento ha già un link video."); return; }
    try {
      const location = this.doc.getElementById("item-location");
      if (location && !location.value.trim()) {
        location.value = safe;
        location.dispatchEvent(new this.win.Event("input", {bubbles: true}));
      } else {
        const attachment = new this.win.CalAttachment();
        attachment.uri = Services.io.newURI(safe);
        this.win.addAttachment(attachment);
      }
      this.showHint("Link video aggiunto. Salva l'evento per confermare.");
    } catch (cause) {
      console.error("[fede-calendar] link video", cause);
      this.showHint("Non riesco ad aggiungere il link all'evento");
    }
  }

  destroy() {
    if (!this.active) return;
    this.active = false;
    this.win.clearTimeout(this.delay);
    this.title.removeEventListener("input", this.onTitleInput);
    this.title.removeEventListener("blur", this.onTitleBlur);
    for (const node of [this.start, this.end]) {
      node.removeEventListener("change", this.onDateChange, true);
      node.removeEventListener("input", this.onDateChange, true);
    }
    this.frame.ownerDocument.removeEventListener("command", this.onSave, true);
    this.hint?.remove();
    if (this.videoState) {
      this.videoState.editors.delete(this);
      if (!this.videoState.editors.size) {
        this.videoState.button.remove();
        FM_VIDEO_TOOLBARS.delete(this.frame.ownerDocument);
      }
    }
  }
}

this.calendarAssist = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.editors = new Map();
    this.windows = new Map();
  }

  attach(win) {
    const state = {frames: new Set()};
    const standalone = win.document.location.href === FM_URLS[0];
    const scan = () => {
      const seen = new Set();
      const visit = (doc, depth) => {
        if (depth > 4) return;
        for (const frame of doc.querySelectorAll("iframe,browser")) {
          let content, href;
          try { content = frame.contentDocument; href = content?.location?.href; } catch (_) { continue; }
          if (!content) continue;
          if (href === FM_IFRAME) {
            seen.add(frame);
            if (!this.editors.has(frame)) {
              const editor = new FmEventEditor(frame);
              if (editor.active) this.editors.set(frame, editor);
            }
            if (this.editors.has(frame)) state.frames.add(frame);
          } else if (content !== doc) {
            visit(content, depth + 1);
          }
        }
      };
      visit(win.document, 0);
      for (const frame of state.frames) {
        if (seen.has(frame)) continue;
        this.editors.get(frame)?.destroy();
        this.editors.delete(frame);
        state.frames.delete(frame);
      }
    };
    const watch = () => scan();
    win.addEventListener("load", watch, true);
    win.document.addEventListener("TabOpen", watch, true);
    win.document.addEventListener("TabSelect", watch, true);
    state.timer = win.setInterval(() => {
      scan();
      if (standalone && state.frames.size) {
        win.clearInterval(state.timer);
        state.timer = null;
      }
    }, standalone ? 100 : 1000);
    state.scan = scan;
    state.watch = watch;
    this.windows.set(win, state);
    scan();
  }

  detach(win) {
    const state = this.windows.get(win);
    if (!state) return;
    win.clearInterval(state.timer);
    win.removeEventListener("load", state.watch, true);
    win.document.removeEventListener("TabOpen", state.watch, true);
    win.document.removeEventListener("TabSelect", state.watch, true);
    for (const frame of state.frames) {
      this.editors.get(frame)?.destroy();
      this.editors.delete(frame);
    }
    this.windows.delete(win);
  }

  onShutdown() {
    if (this.registered) ExtensionSupport.unregisterWindowListener(FM_LISTENER);
    for (const win of [...this.windows.keys()]) this.detach(win);
    this.registered = false;
  }

  getAPI(context) {
    const self = this;
    return {calendarAssist: {
      async init() {
        if (self.registered) return;
        self.registered = true;
        ExtensionSupport.registerWindowListener(FM_LISTENER, {
          chromeURLs: FM_URLS,
          onLoadWindow: win => self.attach(win),
          onUnloadWindow: win => self.detach(win),
        });
      },
    }};
  }
};
