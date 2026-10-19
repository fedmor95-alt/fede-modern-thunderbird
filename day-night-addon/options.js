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
const videoDefaults = {
  googleClientId: "291251992589-otcqefulhj7t9qnih4januqd8g9iro7q.apps.googleusercontent.com",
  googleClientSecret: "",
  zoomClientId: "qQkw0Z2ASlib4thBq5_dOQ",
};
const videoStatus = document.getElementById("video-status");
async function loadVideo() {
  const config = await messenger.storage.local.get(videoDefaults);
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

const fontOutput = document.getElementById("fontSize");
const fontButtons = {
  smaller: document.getElementById("fontSmaller"),
  larger: document.getElementById("fontLarger"),
  reset: document.getElementById("fontReset"),
};
let font = {size: 13, base: 13, min: 9, max: 30};
function showFont() {
  fontOutput.textContent = `${font.size} px`;
  fontButtons.smaller.disabled = font.size <= font.min;
  fontButtons.larger.disabled = font.size >= font.max;
  fontButtons.reset.disabled = font.size === font.base;
}
async function setFont(size) {
  font.size = await messenger.fedeLayout.setFontSize(size);
  showFont();
}
fontButtons.smaller.addEventListener("click", () => setFont(font.size - 1));
fontButtons.larger.addEventListener("click", () => setFont(font.size + 1));
fontButtons.reset.addEventListener("click", () => setFont(font.base));
messenger.fedeLayout.getFontSize().then(value => {
  font = value;
  showFont();
}).catch(error => {fontOutput.textContent = error.message;});
