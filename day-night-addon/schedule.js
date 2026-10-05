export const DEFAULTS = Object.freeze({enabled: true, dayStart: "07:00", nightStart: "20:00"});

export function minutesOfDay(time) {
  if (typeof time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Inserisci un orario valido nel formato HH:MM.");
  }
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function validateSettings(input) {
  const settings = {...DEFAULTS, ...input};
  if (typeof settings.enabled !== "boolean") throw new Error("Pianificazione non valida.");
  if (minutesOfDay(settings.dayStart) === minutesOfDay(settings.nightStart)) {
    throw new Error("Gli orari del tema chiaro e scuro devono essere diversi.");
  }
  return {enabled: settings.enabled, dayStart: settings.dayStart, nightStart: settings.nightStart};
}

// Use wall-clock local time, not elapsed intervals: no UTC offset or 24h arithmetic
// that would drift at a daylight-saving change. Re-evaluated after every wake-up.
export function modeAt(date, input = DEFAULTS) {
  const settings = validateSettings(input);
  if (!settings.enabled) return "system";
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error("Data non valida.");
  const now = date.getHours() * 60 + date.getMinutes();
  const start = minutesOfDay(settings.dayStart);
  const end = minutesOfDay(settings.nightStart);
  const light = start < end ? now >= start && now < end : now >= start || now < end;
  return light ? "light" : "dark";
}
