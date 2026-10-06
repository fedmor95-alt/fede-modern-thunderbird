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

const videoFields = ["googleClientId", "googleClientSecret", "zoomClientId"];
const videoStatus = document.getElementById("video-status");
async function loadVideo() {
  const config = await messenger.storage.local.get(videoFields);
  for (const key of videoFields) document.getElementById(key).value = config[key] || "";
}
async function saveVideo() {
  const config = Object.fromEntries(videoFields.map(key => [key, document.getElementById(key).value.trim()]));
  await messenger.storage.local.set(config);
  await messenger.calendarAssist.configureVideo(config);
  return config;
}
document.getElementById("video-settings").addEventListener("submit", event => event.preventDefault());
for (const [provider, buttonId, idField] of [["google", "connectGoogle", "googleClientId"], ["zoom", "connectZoom", "zoomClientId"]]) {
  const button = document.getElementById(buttonId);
  button.addEventListener("click", async () => {
    if (!document.getElementById(idField).value.trim()) {
      videoStatus.textContent = "Inserisci prima l'ID client OAuth.";
      return;
    }
    button.disabled = true;
    videoStatus.textContent = `Autorizza ${provider === "google" ? "Google Meet" : "Zoom"} nel browser…`;
    try {
      await saveVideo();
      await messenger.calendarAssist.connectVideo(provider);
      videoStatus.textContent = `${provider === "google" ? "Google Meet" : "Zoom"} collegato. Ora puoi creare il link dall'editor evento.`;
    } catch (error) {
      videoStatus.textContent = `Connessione non riuscita: ${error.message || error}`;
    } finally {
      button.disabled = false;
    }
  });
}
loadVideo().catch(error => {videoStatus.textContent = error.message;});
