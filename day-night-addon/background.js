import {DEFAULTS, validateSettings, modeAt} from "./schedule.js";

const ALARM = "day-night-local-clock";
let pending = Promise.resolve();

async function syncSchedule() {
  const settings = validateSettings(await messenger.storage.local.get(DEFAULTS));
  await messenger.dayNight.applyMode(modeAt(new Date(), settings));
  if (!settings.enabled) {
    await messenger.alarms.clear(ALARM);
  } else if (!(await messenger.alarms.get(ALARM))) {
    // Minute fallback also catches resume, timezone, clock, and DST changes.
    messenger.alarms.create(ALARM, {
      when: (Math.floor(Date.now() / 60000) + 1) * 60000,
      periodInMinutes: 1,
    });
  }
}

function update() {
  pending = pending.then(syncSchedule).catch(error => console.error("[day-night]", error));
}

messenger.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) update();
});
messenger.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.keys(DEFAULTS).some(key => key in changes)) update();
  if (area === "local" && ["googleClientId", "googleClientSecret", "zoomClientId"].some(key => key in changes)) {
    messenger.storage.local.get(["googleClientId", "googleClientSecret", "zoomClientId"])
      .then(config => messenger.calendarAssist.configureVideo(config))
      .catch(error => console.error("[calendar-assist] config", error));
  }
});
// Alarms do not survive a Thunderbird restart. Apply immediately and recreate.
update();
messenger.storage.local.get(["googleClientId", "googleClientSecret", "zoomClientId"])
  .then(config => messenger.calendarAssist.init(config))
  .catch(error => console.error("[calendar-assist]", error));
