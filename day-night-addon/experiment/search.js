/* Fede Modern: ricerca come in Mail di Apple e Gmail.
   - La barra in alto cerca mentre si scrive, in tutte le cartelle (indice Gloda).
   - I risultati compaiono nella lista messaggi della scheda, non in una scheda nuova.
   - Sopra la lista: riepilogo, filtri rapidi e «Migliori risultati».
   - I termini cercati sono evidenziati nella lista e nel messaggio aperto.
   Esc o «Chiudi ricerca» riportano alla cartella di prima. Nessun dato cambia. */
var {ExtensionCommon} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var {ExtensionSupport} = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var fsLazy = {};
ChromeUtils.defineESModuleGetters(fsLazy, {
  GlodaMsgSearcher: "resource:///modules/gloda/GlodaMsgSearcher.sys.mjs",
  GlodaSyntheticView: "resource:///modules/gloda/GlodaSyntheticView.sys.mjs",
});

const FS_LISTENER = "fede-modern-search";
const FS_XHTML = "http://www.w3.org/1999/xhtml";
const FS_DELAY = 300;
const FS_TOP_HITS = 3;
const fsWaive = object => object?.wrappedJSObject || object;

/* Operatori: da:mario a:anna oggetto:fattura ha:allegato non:letti */
function fsParse(raw) {
  const filters = {from: "", to: "", attachments: false, unread: false};
  const words = [];
  const terms = [];
  const tokens = raw.match(/"[^"]*"?|\S+/g) || [];
  for (const token of tokens) {
    const match = /^(da|from|a|to|oggetto|subject|ha|has|non|is):(.*)$/i.exec(token);
    if (!match) {
      words.push(token);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].replace(/"/g, "");
    if (["da", "from"].includes(key)) filters.from = value.toLowerCase();
    else if (["a", "to"].includes(key)) filters.to = value.toLowerCase();
    else if (["ha", "has"].includes(key) && /^(allegat|attach)/i.test(value)) filters.attachments = true;
    else if (["non", "is"].includes(key) && /^(lett|unread)/i.test(value)) filters.unread = true;
    else if (value) words.push(value);
    // I valori di da:/a: entrano anche nel testo: Gloda indicizza mittenti e destinatari.
    if (["da", "from", "a", "to"].includes(key) && value) words.push(value);
  }
  for (const word of words) {
    const clean = word.replace(/"/g, "").trim();
    if (clean.length >= 3) terms.push(clean);
  }
  // Gloda ignora parole sotto i 3 caratteri: senza almeno una parola utile non si cerca.
  const text = terms.map(term => (/\s/.test(term) ? `"${term}"` : term)).join(" ");
  return {raw, text, terms, filters};
}

function fsEmail(identity) {
  return (identity?.value || "").toLowerCase();
}

function fsName(identity) {
  return identity?.contact?.name || identity?.value || "";
}

var FedeSearchWindow = class {
  constructor(win) {
    this.win = win;
    this.doc = win.document;
    this.timer = null;
    this.token = 0;
    this.search = null;
    this.pane = null;
    this.onBarEvent = event => this.handleBarEvent(event);
    this.onKeydown = event => {
      if (event.key === "Escape" && this.search && this.isBar(event.composedTarget || event.target)) {
        event.preventDefault();
        this.close();
      }
    };
    for (const type of ["search", "autocomplete", "input"]) this.doc.addEventListener(type, this.onBarEvent, true);
    this.doc.addEventListener("keydown", this.onKeydown, true);
    // Ogni via che aprirebbe la scheda "Ricerca" (suggerimenti, rubrica, Invio
    // dalla tendina) porta invece i risultati nella lista dei messaggi.
    const tabmail = fsWaive(this.tabmail);
    if (tabmail?.openTab) {
      this.tabmailHooked = tabmail;
      this.nativeOpenTab = tabmail.openTab;
      const native = this.nativeOpenTab;
      const self = this;
      tabmail.openTab = function (type, args, ...rest) {
        if ((type === "glodaFacet" || type === "glodaTableList") && (args?.searcher || args?.query)) {
          try {
            self.redirect(args);
            return null;
          } catch (error) {
            console.error("[fede-search]", error);
          }
        }
        return native.call(this, type, args, ...rest);
      };
    }
  }

  redirect(args) {
    const input = this.barInput();
    if (args.searcher) {
      const text = String(args.searcher.searchString || input?.value || "");
      if (input) input.value = text;
      this.run(text).catch(error => console.error("[fede-search]", error));
      return;
    }
    const raw = input?.value?.trim() || this.search?.parsed?.raw || "";
    if (input) input.value = raw;
    this.collect(raw, args.query).catch(error => console.error("[fede-search]", error));
  }

  get tabmail() {
    return this.doc.getElementById("tabmail");
  }

  isBar(node) {
    for (let el = node; el; el = el.parentNode || el.host) {
      if (el.localName === "global-search-bar") return el;
    }
    return null;
  }

  barInput() {
    return this.doc.querySelector("#unifiedToolbarContainer global-search-bar")?.shadowRoot?.querySelector("input");
  }

  /* --- Barra in alto ---------------------------------------------------- */

  handleBarEvent(event) {
    const bar = this.isBar(event.composedTarget || event.target);
    if (!bar) return;
    if (event.type === "autocomplete") {
      // Niente tendina dei suggerimenti: i risultati sono già nella lista.
      event.stopPropagation();
      return;
    }
    if (event.type === "search") {
      // Invio: cerca subito qui invece di aprire la scheda dei risultati.
      event.stopPropagation();
      event.preventDefault();
      this.win.clearTimeout(this.timer);
      this.run(String(event.detail || "")).catch(error => console.error("[fede-search]", error));
      return;
    }
    const value = this.barInput()?.value ?? "";
    this.win.clearTimeout(this.timer);
    if (!value.trim()) {
      if (this.search) this.close({keepInput: true});
      return;
    }
    this.timer = this.win.setTimeout(() => {
      this.run(value).catch(error => console.error("[fede-search]", error));
    }, FS_DELAY);
  }

  /* --- Scheda della posta ----------------------------------------------- */

  mailTab() {
    const tabmail = this.tabmail;
    let tab = tabmail?.currentTabInfo;
    if (tab?.mode?.name !== "mail3PaneTab") {
      tab = tabmail?.tabInfo.find(info => info.mode.name === "mail3PaneTab");
      if (tab) tabmail.switchToTab(tab);
    }
    return tab?.chromeBrowser?.contentWindow ? tab : null;
  }

  /* --- Ricerca ----------------------------------------------------------- */

  async run(raw) {
    const parsed = fsParse(raw);
    if (!parsed.text) {
      if (this.search) this.render(parsed, [], true);
      return;
    }
    const token = ++this.token;
    const results = await new Promise((resolve, reject) => {
      const searcher = new fsLazy.GlodaMsgSearcher(null, parsed.text, true);
      searcher.getCollection({
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          try {
            const scores = searcher.scores || [];
            resolve(collection.items.map((item, index) => ({item, score: scores[index] || 0})));
          } catch (error) {
            reject(error);
          }
        },
      });
    });
    if (token !== this.token) return;
    this.render(parsed, results.filter(result => result.item.folderMessage), false);
  }

  // Risultati di una query già pronta (persona o etichetta scelta dai suggerimenti).
  async collect(raw, query) {
    const parsed = fsParse(raw);
    const token = ++this.token;
    const items = await new Promise(resolve => {
      query.getCollection({
        onItemsAdded() {},
        onItemsModified() {},
        onItemsRemoved() {},
        onQueryCompleted(collection) {
          resolve(collection.items);
        },
      });
    });
    if (token !== this.token) return;
    this.render(parsed, items.filter(item => item.folderMessage).map(item => ({item, score: 0})), false);
  }

  matches(result, parsed, options) {
    const {item} = result;
    const hdr = item.folderMessage;
    if (!hdr) return false;
    const {filters} = parsed;
    if (options.scope === "current" && this.search?.folderURI && hdr.folder.URI !== this.search.folderURI) return false;
    if ((filters.unread || options.unread) && hdr.isRead) return false;
    if ((filters.attachments || options.attachments) && !(hdr.flags & Ci.nsMsgMessageFlags.Attachment)) return false;
    if (options.days && Date.now() - item.date.getTime() > options.days * 86400000) return false;
    const from = options.from || filters.from;
    if (from && !`${fsEmail(item.from)} ${fsName(item.from).toLowerCase()}`.includes(from)) return false;
    const to = options.to || filters.to;
    if (to && !(item.to || []).concat(item.cc || []).some(id => `${fsEmail(id)} ${fsName(id).toLowerCase()}`.includes(to))) return false;
    return true;
  }

  render(parsed, results, tooShort) {
    const tab = this.mailTab();
    if (!tab) return;
    const w = fsWaive(tab.chromeBrowser.contentWindow);
    const first = !this.search;
    if (first) {
      this.search = {folderURI: w.gFolder?.URI || null, options: {scope: "all", unread: false, attachments: false, days: 0, from: "", to: ""}};
      this.attach(w);
    }
    Object.assign(this.search, {parsed, results, tooShort, w});
    this.apply();
  }

  apply() {
    const {w, parsed, results, options, tooShort} = this.search;
    const visible = tooShort ? [] : results.filter(result => this.matches(result, parsed, options));
    const view = new fsLazy.GlodaSyntheticView({collection: {items: visible.map(result => result.item)}});
    try {
      w.gViewWrapper?.close();
    } catch (_) { /* Vista già chiusa. */ }
    w.messagePane?.clearAll?.();
    w.document.body.classList.remove("account-central");
    const central = w.document.getElementById("accountCentralBrowser");
    if (central) central.hidden = true;
    w.gViewWrapper = new w.DBViewWrapper(w.dbViewWrapperListener);
    w.gViewWrapper.openSynthetic(view);
    w.threadTree.currentIndex = visible.length ? 0 : -1;
    w.threadPane?.restoreSortIndicator?.();
    w.threadPaneHeader?.onFolderSelected?.();
    w.document.title = `Ricerca: ${parsed.raw}`;
    this.search.visible = visible;
    this.renderPane(visible);
    this.scheduleDecorate();
  }

  /* --- Pannello sopra la lista ------------------------------------------ */

  attach(w) {
    const doc = w.document;
    doc.body.classList.add("fm-searching");
    const pane = doc.createElementNS(FS_XHTML, "section");
    pane.id = "fm-search-pane";
    pane.setAttribute("aria-label", "Risultati della ricerca");
    const threadPane = doc.getElementById("threadPane");
    threadPane.insertBefore(pane, threadPane.firstChild);
    this.pane = pane;
    // Un clic su una cartella chiude la ricerca e apre quella cartella.
    this.onFolderSelect = () => {
      if (!this.search) return;
      this.close({keepView: false, fromFolder: true});
    };
    doc.getElementById("folderTree")?.addEventListener("select", this.onFolderSelect, true);
    this.observer = new w.MutationObserver(() => this.scheduleDecorate());
    this.observer.observe(doc.getElementById("threadTree"), {childList: true, subtree: true, characterData: true});
    this.onMessageSelect = () => this.win.setTimeout(() => this.highlightMessage(), 700);
    doc.getElementById("threadTree")?.addEventListener("select", this.onMessageSelect);
  }

  el(tag, props = {}, ...children) {
    const node = this.pane.ownerDocument.createElementNS(FS_XHTML, tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "on") for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
      else if (key in node && typeof value !== "string") node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(child => child !== null && child !== undefined));
    return node;
  }

  select(label, value, options, onChange) {
    const select = this.el("select", {class: "fm-chip fm-chip-select", "aria-label": label, on: {change: event => onChange(event.target.value)}});
    for (const [optionValue, text] of options) {
      const option = this.el("option", {value: optionValue}, text);
      if (optionValue === value) option.selected = true;
      select.append(option);
    }
    if (value) select.classList.add("fm-chip-active");
    return select;
  }

  toggle(label, active, onToggle) {
    return this.el("button", {
      type: "button",
      class: "fm-chip" + (active ? " fm-chip-active" : ""),
      "aria-pressed": String(active),
      on: {click: onToggle},
    }, label);
  }

  topPeople(field) {
    const counts = new Map();
    for (const {item} of this.search.results) {
      const people = field === "from" ? [item.from] : (item.to || []);
      for (const id of people) {
        const email = fsEmail(id);
        if (!email) continue;
        const entry = counts.get(email) || {email, name: fsName(id), count: 0};
        entry.count++;
        counts.set(email, entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }

  renderPane(visible) {
    const {parsed, options, results, tooShort, folderURI} = this.search;
    const update = change => {
      Object.assign(options, change);
      this.apply();
    };
    const count = visible.length;
    const summary = tooShort ? "Scrivi almeno 3 lettere per cercare" :
      count === 0 ? "Nessun messaggio trovato" :
      `${count} ${count === 1 ? "messaggio" : "messaggi"}` + (options.scope === "all" ? " in tutte le cartelle" : " in questa cartella");
    const header = this.el("div", {class: "fm-search-header"},
      this.el("div", {class: "fm-search-title"},
        this.el("h2", {}, "Risultati per ", this.el("q", {}, parsed.raw.trim())),
        this.el("span", {class: "fm-search-count", role: "status"}, summary)),
      this.el("button", {type: "button", class: "fm-search-close", title: "Chiudi ricerca (Esc)", on: {click: () => this.close()}}, "Chiudi"));
    const people = field => [["", field === "from" ? "Da: chiunque" : "A: chiunque"],
      ...this.topPeople(field).map(person => [person.email, (field === "from" ? "Da: " : "A: ") + (person.name || person.email)])];
    const chips = this.el("div", {class: "fm-search-filters", role: "group", "aria-label": "Filtri"},
      this.select("Cartelle", options.scope, folderURI ? [["all", "Tutte le cartelle"], ["current", "Questa cartella"]] : [["all", "Tutte le cartelle"]], value => update({scope: value})),
      this.toggle("Non letti", options.unread || parsed.filters.unread, () => update({unread: !options.unread})),
      this.toggle("Con allegati", options.attachments || parsed.filters.attachments, () => update({attachments: !options.attachments})),
      this.select("Periodo", String(options.days || ""), [["", "Sempre"], ["7", "Ultimi 7 giorni"], ["30", "Ultimi 30 giorni"], ["365", "Ultimo anno"]], value => update({days: Number(value) || 0})),
      this.select("Mittente", options.from, people("from"), value => update({from: value})),
      this.select("Destinatario", options.to, people("to"), value => update({to: value})));
    const children = [header];
    if (!tooShort) children.push(chips);
    // Migliori risultati per rilevanza; sotto, la lista completa ordinata per data.
    if (!tooShort && visible.length > FS_TOP_HITS + 2) {
      const top = [...visible].sort((a, b) => b.score - a.score).slice(0, FS_TOP_HITS);
      const dateFormat = new Intl.DateTimeFormat("it", {day: "numeric", month: "short", year: "numeric"});
      children.push(this.el("div", {class: "fm-search-top"},
        this.el("h3", {}, "Migliori risultati"),
        ...top.map(({item}) => this.el("button", {
          type: "button",
          class: "fm-search-hit",
          on: {click: () => this.selectMessage(item.folderMessage)},
        },
        this.el("span", {class: "fm-hit-sender"}, fsName(item.from)),
        this.el("span", {class: "fm-hit-date"}, dateFormat.format(item.date)),
        this.el("span", {class: "fm-hit-subject"}, item.subject || "(senza oggetto)"),
        this.el("span", {class: "fm-hit-folder"}, item.folderMessage?.folder?.localizedName || "")))));
      children.push(this.el("h3", {class: "fm-search-all"}, "Tutti i risultati"));
    }
    this.pane.replaceChildren(...children);
    if (results.length && !this.search.highlightSet) this.search.highlightSet = true;
  }

  selectMessage(hdr) {
    const w = this.search?.w;
    if (!w || !hdr) return;
    const index = w.gDBView?.findIndexOfMsgHdr(hdr, true);
    if (index >= 0) {
      w.threadTree.selectedIndex = index;
      w.threadTree.scrollToIndex?.(index);
      w.threadTree.table?.body?.focus();
    }
  }

  /* --- Evidenziazione ---------------------------------------------------- */

  scheduleDecorate() {
    if (this.decorating || !this.search) return;
    this.decorating = true;
    this.win.requestAnimationFrame(() => {
      this.decorating = false;
      try {
        this.decorate();
      } catch (error) {
        console.error("[fede-search] evidenziazione", error);
      }
    });
  }

  decorate() {
    const w = this.search?.w;
    if (!w) return;
    const terms = (this.search.parsed.terms || []).map(term => term.toLowerCase()).filter(Boolean);
    const registry = w.CSS?.highlights;
    if (!registry) return;
    const highlight = new w.Highlight();
    const doc = w.document;
    const rows = doc.querySelectorAll("#threadTree tbody tr");
    for (const row of rows) {
      // Anteprima del testo sotto l'oggetto, come in Mail.
      if (row.localName === "tr" && row.getAttribute("is") === "thread-card") this.decoratePreview(w, row);
      const walker = doc.createTreeWalker(row, w.NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.data.toLowerCase();
        for (const term of terms) {
          let from = 0;
          for (let at = text.indexOf(term, from); at >= 0; at = text.indexOf(term, from)) {
            const range = doc.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + term.length);
            highlight.add(range);
            from = at + term.length;
          }
        }
      }
    }
    registry.set("fm-search", highlight);
  }

  decoratePreview(w, row) {
    const index = row.index;
    if (typeof index !== "number" || index < 0) return;
    let hdr;
    try {
      hdr = w.gDBView.getMsgHdrAt(index);
    } catch (_) {
      return;
    }
    let preview = hdr?.getStringProperty("preview") || "";
    if (!preview && hdr && !this.search.previewRequested?.has(hdr.messageKey + hdr.folder.URI)) {
      (this.search.previewRequested ||= new Set()).add(hdr.messageKey + hdr.folder.URI);
      try {
        hdr.folder.fetchMsgPreviewText([hdr.messageKey], null);
        preview = hdr.getStringProperty("preview") || "";
      } catch (_) { /* Messaggio non scaricato: niente anteprima. */ }
    }
    let line = row.querySelector(".fm-search-preview");
    const host = row.querySelector(".subject")?.parentNode;
    if (!host) return;
    if (!line) {
      line = w.document.createElementNS(FS_XHTML, "div");
      line.className = "fm-search-preview";
      host.append(line);
    }
    const text = preview.replace(/\s+/g, " ").trim().slice(0, 180);
    if (line.textContent !== text) line.textContent = text;
  }

  highlightMessage() {
    const w = this.search?.w;
    const term = this.search?.parsed.terms?.[0];
    if (!w || !term) return;
    try {
      const aboutMessage = fsWaive(w.messageBrowser?.contentWindow);
      const browser = aboutMessage?.document.getElementById("messagepane");
      browser?.finder?.highlight(true, term, false, false);
    } catch (error) {
      console.error("[fede-search] evidenziazione messaggio", error);
    }
  }

  /* --- Chiusura ---------------------------------------------------------- */

  close({keepInput = false, fromFolder = false} = {}) {
    const search = this.search;
    if (!search) return;
    this.search = null;
    this.token++;
    this.win.clearTimeout(this.timer);
    const w = search.w;
    if (w) {
      const doc = w.document;
      doc.body.classList.remove("fm-searching");
      this.pane?.remove();
      this.pane = null;
      this.observer?.disconnect();
      doc.getElementById("folderTree")?.removeEventListener("select", this.onFolderSelect, true);
      doc.getElementById("threadTree")?.removeEventListener("select", this.onMessageSelect);
      w.CSS?.highlights?.delete("fm-search");
      for (const line of doc.querySelectorAll(".fm-search-preview")) line.remove();
      try {
        w.gViewWrapper?.close();
      } catch (_) { /* Vista già chiusa. */ }
      w.gViewWrapper = null;
      if (!fromFolder) {
        // Riapre la cartella di prima: _onSelect legge la riga selezionata.
        if (w.folderTree?.selectedRow) w.folderPane._onSelect();
        else if (search.folderURI) w.displayFolder(search.folderURI);
      }
    }
    if (!keepInput) {
      const input = this.barInput();
      if (input) input.value = "";
    }
  }

  destroy() {
    this.close({keepInput: true});
    for (const type of ["search", "autocomplete", "input"]) this.doc.removeEventListener(type, this.onBarEvent, true);
    this.doc.removeEventListener("keydown", this.onKeydown, true);
    if (this.tabmailHooked) this.tabmailHooked.openTab = this.nativeOpenTab;
  }
};

var fedeSearchWindows = new Map();
var fedeSearchRegistered = false;

this.fedeSearch = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      fedeSearch: {
        async init() {
          if (fedeSearchRegistered) return;
          fedeSearchRegistered = true;
          ExtensionSupport.registerWindowListener(FS_LISTENER, {
            chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
            onLoadWindow(win) {
              try {
                fedeSearchWindows.set(win, new FedeSearchWindow(win));
              } catch (error) {
                console.error("[fede-search]", error);
              }
            },
            onUnloadWindow(win) {
              fedeSearchWindows.get(win)?.destroy();
              fedeSearchWindows.delete(win);
            },
          });
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown || !fedeSearchRegistered) return;
    fedeSearchRegistered = false;
    ExtensionSupport.unregisterWindowListener(FS_LISTENER);
    for (const search of fedeSearchWindows.values()) search.destroy();
    fedeSearchWindows.clear();
  }
};
