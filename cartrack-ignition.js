(function (root) {
  "use strict";
  function timestamp(value) {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value)) return null;
    const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    const time = Date.parse(normalized);
    return Number.isFinite(time) ? time : null;
  }
  function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const value = Math.floor(seconds);
    return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, "0")).join(":");
  }
  function rows(trips, range, plate = "") {
    const query = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const seen = new Set();
    return trips.filter(trip => {
      const key = String(trip.registration) + "|" + String(trip.id ?? trip.start);
      if (seen.has(key)) return false;
      seen.add(key);
      return !query || String(trip.registration).toUpperCase().replace(/[^A-Z0-9]/g, "").includes(query);
    }).map(trip => {
      const start = timestamp(trip.start), end = timestamp(trip.end);
      const invalid = start === null || (trip.end != null && (end === null || end < start));
      return {...trip, startMs:start, endMs:end, invalid,
        seconds: invalid || end === null ? null : Math.floor((end-start)/1000),
        crossesPeriod: !invalid && (start < range.start || (end !== null && end > range.end))};
    }).filter(trip => trip.invalid || (trip.startMs < range.end && (trip.endMs === null || trip.endMs > range.start)))
      .sort((a,b) => (b.startMs ?? 0) - (a.startMs ?? 0));
  }
  const api = {timestamp, duration, rows};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CartrackIgnition = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
