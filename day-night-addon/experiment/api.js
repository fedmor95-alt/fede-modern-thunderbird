var {ExtensionCommon} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

const TARGET = "ui.systemUsesDarkTheme";
const OWNER = "extensions.fede-day-night.preference-owner";
const INT = 64;
const BOOL = 128;
const STRING = 32;

function readUserPref(name) {
  if (!Services.prefs.prefHasUserValue(name)) return {exists: false};
  const type = Services.prefs.getPrefType(name);
  const getters = {[INT]: "getIntPref", [BOOL]: "getBoolPref", [STRING]: "getStringPref"};
  if (!getters[type]) throw new Error("Tipo di preferenza non supportato.");
  return {exists: true, type, value: Services.prefs[getters[type]](name)};
}

function writeUserPref(name, pref) {
  if (!pref.exists) {
    Services.prefs.clearUserPref(name);
    return;
  }
  const setters = {[INT]: "setIntPref", [BOOL]: "setBoolPref", [STRING]: "setStringPref"};
  if (Services.prefs.prefHasUserValue(name) && Services.prefs.getPrefType(name) !== pref.type) {
    Services.prefs.clearUserPref(name);
  }
  Services.prefs[setters[pref.type]](name, pref.value);
}

function validPrevious(pref) {
  return pref && (pref.exists === false || (pref.exists === true && (
    (pref.type === INT && Number.isInteger(pref.value)) ||
    (pref.type === BOOL && typeof pref.value === "boolean") ||
    (pref.type === STRING && typeof pref.value === "string")
  )));
}

function readOwner() {
  if (!Services.prefs.prefHasUserValue(OWNER)) return null;
  const record = JSON.parse(Services.prefs.getStringPref(OWNER));
  if (record.version !== 1 || !validPrevious(record.previous) || ![0, 1].includes(record.lastApplied)) {
    throw new Error("Snapshot della preferenza non valido: nessuna modifica applicata.");
  }
  return record;
}

function restore() {
  const owner = readOwner();
  if (!owner) return;
  const current = readUserPref(TARGET);
  // A newer value written outside this extension belongs to the user.
  if (current.exists && current.type === INT && current.value === owner.lastApplied) {
    writeUserPref(TARGET, owner.previous);
  }
  Services.prefs.clearUserPref(OWNER);
}

this.dayNight = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      dayNight: {
        async applyMode(mode) {
          if (mode === "system") {
            restore();
            return;
          }
          if (!["light", "dark"].includes(mode)) throw new Error("Tema non valido.");
          const value = mode === "dark" ? 1 : 0;
          const owner = readOwner() || {version: 1, previous: readUserPref(TARGET)};
          owner.lastApplied = value;
          // Persist the original user preference across app restarts and updates.
          Services.prefs.setStringPref(OWNER, JSON.stringify(owner));
          const current = readUserPref(TARGET);
          if (!current.exists || current.type !== INT || current.value !== value) {
            writeUserPref(TARGET, {exists: true, type: INT, value});
          }
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    try {
      restore();
    } catch (error) {
      console.error("[day-night] Impossibile ripristinare la preferenza:", error);
    }
  }
};
