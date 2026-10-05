/* Small, local Italian event-title parser. It never reads contacts or mail. */
const DAYS = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const simplify = value => value.toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function removeRanges(value, ranges) {
  let result = value;
  for (const [from, to] of ranges.sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, from) + result.slice(to);
  }
  return result.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "");
}

function explicitDate(year, month, day, now, hasYear) {
  for (let candidate = year; candidate < year + (hasYear ? 1 : 8); candidate++) {
    const parsed = new Date(candidate, month, day);
    if (parsed.getFullYear() !== candidate || parsed.getMonth() !== month || parsed.getDate() !== day) continue;
    if (hasYear || parsed >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) return parsed;
  }
  return null;
}

export function parseTitle(value, now = new Date(), selectedDate = now) {
  if (typeof value !== "string" || value.length > 400 || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const folded = simplify(value);
  const ranges = [];
  let date = null;

  const relative = /\b(oggi|domani|dopodomani)\b/i.exec(folded);
  if (relative) {
    date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (relative[1] === "oggi" ? 0 : relative[1] === "domani" ? 1 : 2));
    ranges.push([relative.index, relative.index + relative[0].length]);
  }

  const fullDate = /\b(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?\b/.exec(folded);
  if (fullDate) {
    if (date) return null;
    const year = fullDate[3] ? Number(fullDate[3]) : now.getFullYear();
    date = explicitDate(year, MONTHS.indexOf(fullDate[2]), Number(fullDate[1]), now, !!fullDate[3]);
    if (!date) return null;
    ranges.push([fullDate.index, fullDate.index + fullDate[0].length]);
  }

  const weekday = /\b(?:lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.exec(folded);
  if (weekday) {
    const wanted = DAYS.indexOf(weekday[0]);
    if (!date) {
      let offset = (wanted - now.getDay() + 7) % 7;
      if (offset === 0) offset = 7;
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    } else if (date.getDay() !== wanted) {
      return null;
    }
    ranges.push([weekday.index, weekday.index + weekday[0].length]);
  }

  const time = /\b(?:alle|ore|dalle)\s+([01]?\d|2[0-3])(?:(?::|\.)([0-5]\d))?\b/.exec(folded);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2] || 0);
  ranges.push([time.index, time.index + time[0].length]);
  if (!date) {
    if (!(selectedDate instanceof Date) || !Number.isFinite(selectedDate.getTime())) return null;
    date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  }
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
  if (start.getHours() !== hour || start.getMinutes() !== minute) return null;
  if (relative?.[1] === "oggi" && start < now) return null;

  let durationMinutes = 60;
  const duration = /\bper\s+(\d+(?:[.,]\d+)?)\s*(ore?|minuti?)\b/.exec(folded);
  if (duration) {
    durationMinutes = Math.round(Number(duration[1].replace(",", ".")) * (duration[2].startsWith("or") ? 60 : 1));
    if (durationMinutes < 5 || durationMinutes > 1440) return null;
    ranges.push([duration.index, duration.index + duration[0].length]);
  }
  const ending = /\b(?:fino\s+)?alle\s+([01]?\d|2[0-3])(?:(?::|\.)([0-5]\d))?\b/g;
  let endMatch;
  while ((endMatch = ending.exec(folded))) {
    if (endMatch.index > time.index) {
      const endHour = Number(endMatch[1]);
      const endMinute = Number(endMatch[2] || 0);
      const endCandidate = new Date(start.getFullYear(), start.getMonth(), start.getDate(), endHour, endMinute);
      durationMinutes = Math.round((endCandidate - start) / 60000);
      if (durationMinutes < 5 || durationMinutes > 1440) return null;
      ranges.push([endMatch.index, endMatch.index + endMatch[0].length]);
      break;
    }
  }

  let person = null;
  const participant = /\bcon\s+([a-zà-ÿ][a-zà-ÿ' -]{0,45})\s*$/i.exec(value);
  if (participant) {
    person = participant[1].trim();
    ranges.push([participant.index, participant.index + participant[0].length]);
  }
  const title = removeRanges(value, ranges);
  if (!title) return null;
  return {title, start, end: new Date(start.getTime() + durationMinutes * 60000), person};
}
