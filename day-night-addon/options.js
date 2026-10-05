import {DEFAULTS, validateSettings} from "./schedule.js";

const elements = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, document.getElementById(key)]));
const status = document.getElementById("status");
document.getElementById("timezone").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function load() {
  const settings = validateSettings(await messenger.storage.local.get(DEFAULTS));
  elements.enabled.checked = settings.enabled;
  elements.dayStart.value = settings.dayStart;
  elements.nightStart.value = settings.nightStart;
}

document.getElementById("settings").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const settings = validateSettings({
      enabled: elements.enabled.checked,
      dayStart: elements.dayStart.value,
      nightStart: elements.nightStart.value,
    });
    await messenger.storage.local.set(settings);
    status.textContent = "Impostazioni salvate.";
  } catch (error) {
    status.textContent = error.message;
  }
});
load().catch(error => {status.textContent = error.message;});
