/* Fede Modern: barra laterale come in Mail di Apple.
   - Il pulsante in alto a sinistra mostra/nasconde la barra laterale dello
     spazio corrente (Posta, Calendario, Attività, Rubrica, Chat). Anche F9.
   - Gli spazi stanno in una barra compatta in fondo alla barra laterale.
   - Backspace elimina i messaggi selezionati, come Canc.
   Nessun dato di posta viene modificato: solo interfaccia. */
var {ExtensionCommon} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var {ExtensionSupport} = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const FM_LAYOUT_LISTENER = "fede-modern-layout";
const FM_XHTML = "http://www.w3.org/1999/xhtml";
const FM_ICONS = "chrome://messenger/skin/icons/new/compact/";
const FM_SPACES = [
  {name: "mail", label: "Posta", icon: "mail.svg"},
  {name: "calendar", label: "Calendario", icon: "calendar.svg"},
  {name: "addressbook", label: "Rubrica", icon: "address-book.svg"},
  {name: "tasks", label: "Attività", icon: "tasks.svg"},
  {name: "chat", label: "Chat", icon: "chat.svg"},
];
const FM_SETTINGS = {name: "settings", label: "Impostazioni", icon: "settings.svg"};
const FM_MAIL_MODES = new Set(["mail3PaneTab", "mailMessageTab"]);
// I metodi degli elementi personalizzati (PaneSplitter) non passano dagli Xray.
const fmWaive = object => object?.wrappedJSObject || object;

var FedeLayoutWindow = class {
  constructor(win) {
    this.win = win;
    this.doc = win.document;
    this.timer = null;
    this.docks = new Set();
    this.browsers = new Set();
    this.queue = () => {
      if (this.timer !== null) return;
      this.timer = this.win.setTimeout(() => {
        this.timer = null;
        this.refresh();
      }, 0);
    };
    this.onKey = event => this.handleKey(event);
    this.tabMonitor = {
      monitorName: "fedeModernLayout",
      onTabTitleChanged() {},
      onTabSwitched: this.queue,
      onTabOpened: this.queue,
      onTabClosing: this.queue,
      onTabPersist() {},
      onTabRestored() {},
    };
    this.observer = new win.MutationObserver(this.queue);
    win.addEventListener("keydown", this.onKey);
    // Pane splitters, new tabs and lazy documents all bubble to the window.
    for (const type of ["load", "splitter-collapsed", "splitter-expanded"]) {
      win.addEventListener(type, this.queue, true);
    }
    this.tabmail?.registerTabMonitor(this.tabMonitor);
    this.refresh();
  }

  get tabmail() {
    return this.doc.getElementById("tabmail");
  }

  get spacesToolbar() {
    return this.win.gSpacesToolbar?.isLoaded ? this.win.gSpacesToolbar : null;
  }

  /* --- Barra laterale ------------------------------------------------- */

  sidebarFor(tab = this.tabmail?.currentTabInfo) {
    const mode = tab?.mode?.name;
    if (mode === "mail3PaneTab") {
      const splitter = fmWaive(fmWaive(tab.chromeBrowser?.contentWindow)?.paneLayout?.folderPaneSplitter);
      if (!splitter || splitter.isDisabled) return null;
      return {
        visible: () => !splitter.isCollapsed,
        toggle: () => splitter.toggleCollapsed(),
      };
    }
    if (mode === "addressBookTab") {
      const splitter = fmWaive(tab.browser?.contentDocument?.getElementById("booksSplitter"));
      if (!splitter?.toggleCollapsed) return null;
      return {
        visible: () => !splitter.isCollapsed,
        toggle: () => splitter.toggleCollapsed(),
      };
    }
    const id = {calendar: "calsidebar_splitter", tasks: "calsidebar_splitter", chat: "listSplitter"}[mode];
    const splitter = id && this.doc.getElementById(id);
    if (!splitter) return null;
    return {
      visible: () => splitter.getAttribute("state") !== "collapsed",
      toggle: () => splitter.setAttribute("state", splitter.getAttribute("state") === "collapsed" ? "open" : "collapsed"),
    };
  }

  toggleSidebar() {
    const sidebar = this.sidebarFor();
    if (!sidebar) return false;
    sidebar.toggle();
    this.queue();
    return true;
  }

  ensureToggle() {
    const toolbar = this.doc.getElementById("unifiedToolbar");
    if (!toolbar) return null;
    let button = this.doc.getElementById("fm-sidebar-toggle");
    if (!button) {
      button = this.doc.createElementNS(FM_XHTML, "button");
      button.id = "fm-sidebar-toggle";
      button.type = "button";
      button.className = "button toolbar-button fm-sidebar-toggle";
      button.append(this.doc.createElementNS(FM_XHTML, "span"));
      button.addEventListener("click", event => {
        if (event.button === 0) this.toggleSidebar();
      });
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        this.openSpacesMenu(button, "after_start");
      });
      toolbar.prepend(button);
      this.observer.observe(toolbar.parentNode, {childList: true, subtree: true});
    }
    return button;
  }

  updateToggle(button) {
    const sidebar = this.sidebarFor();
    const visible = !!sidebar?.visible();
    const label = !sidebar ? "Nessuna barra laterale in questa scheda" :
      visible ? "Nascondi barra laterale (F9)" : "Mostra barra laterale (F9)";
    if (button.disabled !== !sidebar) button.disabled = !sidebar;
    if (button.getAttribute("aria-pressed") !== String(visible)) button.setAttribute("aria-pressed", String(visible));
    if (button.getAttribute("title") !== label) {
      button.setAttribute("title", label);
      button.setAttribute("aria-label", label);
    }
  }

  /* --- Spazi in fondo alla barra laterale ----------------------------- */

  openSpace(name) {
    const toolbar = this.spacesToolbar;
    const space = toolbar?.spaces?.find(item => item.name === name);
    if (!space) return;
    toolbar.openSpace(this.tabmail, space);
    this.queue();
  }

  addonSpaceButtons() {
    return [...this.doc.querySelectorAll("#spacesToolbarAddonsContainer > button")];
  }

  ensureMenu() {
    let popup = this.doc.getElementById("fm-spaces-menu");
    if (popup) return popup;
    popup = this.doc.createXULElement("menupopup");
    popup.id = "fm-spaces-menu";
    popup.addEventListener("popupshowing", event => {
      if (event.target === popup) this.fillMenu(popup);
    });
    (this.doc.getElementById("mainPopupSet") || this.doc.documentElement).append(popup);
    return popup;
  }

  fillMenu(popup) {
    popup.replaceChildren();
    const current = this.spacesToolbar?.currentSpace?.name;
    const item = (label, icon, command, checked = false) => {
      const menuitem = this.doc.createXULElement("menuitem");
      menuitem.setAttribute("label", label);
      menuitem.className = "menuitem-iconic";
      if (icon) menuitem.setAttribute("image", icon);
      if (checked) {
        menuitem.setAttribute("type", "checkbox");
        menuitem.setAttribute("checked", "true");
      }
      menuitem.addEventListener("command", command);
      popup.append(menuitem);
    };
    for (const space of [...FM_SPACES, FM_SETTINGS]) {
      item(space.label, FM_ICONS + space.icon, () => this.openSpace(space.name), space.name === current);
    }
    const addons = this.addonSpaceButtons();
    if (addons.length) popup.append(this.doc.createXULElement("menuseparator"));
    for (const button of addons) {
      const icon = button.querySelector("img")?.src || null;
      item(button.title || button.getAttribute("aria-label") || "Spazio", icon, () => button.click());
    }
    popup.append(this.doc.createXULElement("menuseparator"));
    const toolbar = this.spacesToolbar;
    item(toolbar && !toolbar.isHidden ? "Nascondi la barra degli spazi" : "Mostra la barra degli spazi classica", null,
      () => this.spacesToolbar?.toggleToolbar(!this.spacesToolbar.isHidden));
  }

  openSpacesMenu(anchor, position) {
    const popup = this.ensureMenu();
    if (popup.state === "open" || popup.state === "showing") {
      popup.hidePopup();
      return;
    }
    popup.openPopup(anchor, position);
  }

  createDock(container) {
    const doc = container.ownerDocument;
    const dock = doc.createElementNS(FM_XHTML, "div");
    dock.className = "fm-space-dock";
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Spazi");
    const make = space => {
      const button = doc.createElementNS(FM_XHTML, "button");
      button.type = "button";
      button.className = "fm-space-button";
      button.dataset.space = space.name;
      button.title = space.label;
      button.setAttribute("aria-label", space.label);
      const img = doc.createElementNS(FM_XHTML, "img");
      img.src = FM_ICONS + space.icon;
      img.alt = "";
      button.append(img);
      return button;
    };
    for (const space of FM_SPACES) {
      const button = make(space);
      button.addEventListener("click", () => this.openSpace(space.name));
      dock.append(button);
    }
    const spacer = doc.createElementNS(FM_XHTML, "span");
    spacer.className = "fm-space-spacer";
    dock.append(spacer);
    const more = make({name: "more", label: "Altri spazi", icon: "more.svg"});
    more.setAttribute("aria-haspopup", "menu");
    more.addEventListener("click", () => this.openSpacesMenu(more, "before_end"));
    dock.append(more);
    const settings = make(FM_SETTINGS);
    settings.addEventListener("click", () => this.openSpace(FM_SETTINGS.name));
    dock.append(settings);
    // Tutti gli spazi e la barra classica restano raggiungibili dal menu.
    dock.addEventListener("contextmenu", event => {
      event.preventDefault();
      this.openSpacesMenu(event.target.closest("button") || dock, "before_start");
    });
    // Frecce sinistra/destra come in una vera barra di strumenti.
    dock.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const buttons = [...dock.querySelectorAll("button:not([hidden])")];
      const index = buttons.indexOf(doc.activeElement);
      if (index < 0) return;
      const step = (event.key === "ArrowRight") === (doc.dir !== "rtl") ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].focus();
      event.preventDefault();
    });
    container.append(dock);
    this.docks.add(dock);
    return dock;
  }

  dockContainers() {
    const containers = [this.doc.getElementById("calSidebar"), this.doc.getElementById("listPaneBox")];
    for (const browser of this.doc.querySelectorAll("browser")) {
      if (!this.browsers.has(browser)) {
        // Rubrica e nuove schede caricano dopo l'apertura della scheda.
        this.browsers.add(browser);
        browser.addEventListener("load", this.queue, true);
      }
      try {
        const inner = browser.contentDocument;
        const url = inner?.location.href;
        if (url === "about:3pane") containers.push(inner.getElementById("folderPane"));
        else if (url === "about:addressbook") containers.push(inner.getElementById("booksPane"));
      } catch (_) { /* Schede web remote: fuori da questa personalizzazione. */ }
    }
    return containers.filter(Boolean);
  }

  updateDock(dock) {
    const toolbar = this.spacesToolbar;
    const current = toolbar?.currentSpace?.name;
    const badges = new Set((toolbar?.spaces || []).filter(space => space.button?.classList.contains("has-badge")).map(space => space.name));
    const addons = this.addonSpaceButtons();
    for (const button of dock.querySelectorAll(".fm-space-button")) {
      const name = button.dataset.space;
      if (name === "more") {
        // Solo se ci sono spazi aggiunti da estensioni; il menu resta sul tasto destro.
        if (button.hidden !== !addons.length) button.hidden = !addons.length;
        button.classList.toggle("has-badge", addons.some(addon => addon.classList.contains("has-badge")));
        continue;
      }
      if (name === current) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      button.classList.toggle("has-badge", badges.has(name));
    }
  }

  /* --- Tastiera -------------------------------------------------------- */

  isEditable(node) {
    for (let el = node; el; el = el.parentNode || el.host) {
      if (el.nodeType !== 1) continue;
      if (el.isContentEditable || ["input", "textarea", "select", "global-search-bar", "search-bar"].includes(el.localName)) return true;
      if (el.ownerDocument?.designMode === "on") return true;
    }
    return false;
  }

  handleKey(event) {
    if (!event.isTrusted || event.defaultPrevented || event.isComposing) return;
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    if (event.key === "F9" && plain) {
      if (this.toggleSidebar()) event.preventDefault();
      return;
    }
    if (event.key !== "Backspace" || !plain) return;
    if (!FM_MAIL_MODES.has(this.tabmail?.currentTabInfo?.mode?.name)) return;
    const target = event.composedTarget || event.originalTarget;
    // Mai sulle cartelle: lì Canc elimina la cartella, non i messaggi.
    if (this.isEditable(target) || target?.closest?.("#folderPane, #quick-filter-bar")) return;
    event.preventDefault();
    this.win.goDoCommand("cmd_delete");
  }

  /* --- Ciclo di vita --------------------------------------------------- */

  refresh() {
    if (!this.doc.documentElement.hasAttribute("data-fm-layout")) {
      this.doc.documentElement.setAttribute("data-fm-layout", "true");
    }
    const toggle = this.ensureToggle();
    if (toggle) this.updateToggle(toggle);
    for (const container of this.dockContainers()) {
      const dock = container.querySelector(":scope > .fm-space-dock") || this.createDock(container);
      this.updateDock(dock);
    }
    for (const dock of this.docks) {
      if (!dock.isConnected) this.docks.delete(dock);
    }
    for (const browser of this.browsers) {
      if (!browser.isConnected) this.browsers.delete(browser);
    }
    const spaces = this.doc.getElementById("spacesToolbar");
    if (spaces && !this.watchingSpaces) {
      // Badge della chat e pulsanti degli spazi delle estensioni.
      this.observer.observe(spaces, {subtree: true, childList: true, attributes: true, attributeFilter: ["class"]});
      for (const id of ["calsidebar_splitter", "listSplitter"]) {
        const splitter = this.doc.getElementById(id);
        if (splitter) this.observer.observe(splitter, {attributes: true, attributeFilter: ["state"]});
      }
      this.watchingSpaces = true;
    }
  }

  destroy() {
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.observer.disconnect();
    this.win.removeEventListener("keydown", this.onKey);
    for (const type of ["load", "splitter-collapsed", "splitter-expanded"]) {
      this.win.removeEventListener(type, this.queue, true);
    }
    this.tabmail?.unregisterTabMonitor(this.tabMonitor);
    for (const browser of this.browsers) browser.removeEventListener("load", this.queue, true);
    this.browsers.clear();
    for (const dock of this.docks) dock.remove();
    this.docks.clear();
    this.doc.getElementById("fm-sidebar-toggle")?.remove();
    this.doc.getElementById("fm-spaces-menu")?.remove();
    this.doc.documentElement.removeAttribute("data-fm-layout");
  }
};

var fedeLayoutWindows = new Map();
var fedeLayoutRegistered = false;

this.fedeLayout = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      fedeLayout: {
        async init() {
          if (fedeLayoutRegistered) return;
          fedeLayoutRegistered = true;
          ExtensionSupport.registerWindowListener(FM_LAYOUT_LISTENER, {
            chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
            onLoadWindow(win) {
              try {
                fedeLayoutWindows.set(win, new FedeLayoutWindow(win));
              } catch (error) {
                console.error("[fede-layout]", error);
              }
            },
            onUnloadWindow(win) {
              fedeLayoutWindows.get(win)?.destroy();
              fedeLayoutWindows.delete(win);
            },
          });
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    if (!fedeLayoutRegistered) return;
    fedeLayoutRegistered = false;
    ExtensionSupport.unregisterWindowListener(FM_LAYOUT_LISTENER);
    for (const layout of fedeLayoutWindows.values()) layout.destroy();
    fedeLayoutWindows.clear();
  }
};
