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
  function summary(trips, range, plate, calendar) {
    const source = rows(trips, range, plate);
    const byVehicle = new Map();
    let excluded = 0;
    for (const row of source) {
      if (row.invalid || row.endMs === null || !row.registration) { excluded++; continue; }
      const start = Math.max(row.startMs, range.start), end = Math.min(row.endMs, range.end);
      if (!byVehicle.has(row.registration)) byVehicle.set(row.registration, []);
      byVehicle.get(row.registration).push([start, end]);
    }
    const daily = [], vehicles = [];
    for (const [registration, intervals] of byVehicle) {
      intervals.sort((a,b) => a[0]-b[0]);
      const merged = [];
      for (const interval of intervals) {
        const previous = merged[merged.length-1];
        if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
        else merged.push([...interval]);
      }
      const days = new Map();
      let total = 0;
      for (const [start, end] of merged) {
        if (start === end) { const day = calendar.day(start); if (!days.has(day)) days.set(day, 0); }
        for (let time = start; time < end;) {
          const day = calendar.day(time);
          const next = Math.min(end, calendar.nextDayStart(day));
          if (!Number.isFinite(next) || next <= time) throw new Error("Invalid calendar boundary");
          const seconds = (next-time)/1000;
          days.set(day, (days.get(day) || 0) + seconds);
          total += seconds;
          time = next;
        }
      }
      vehicles.push({registration, seconds:total});
      for (const [day, seconds] of days) daily.push({day, registration, seconds});
    }
    daily.sort((a,b) => b.day.localeCompare(a.day) || a.registration.localeCompare(b.registration));
    vehicles.sort((a,b) => a.registration.localeCompare(b.registration));
    return {daily, vehicles, excluded, totalSeconds:vehicles.length ? vehicles.reduce((sum,row)=>sum+row.seconds,0) : null};
  }
  const api = {timestamp, duration, rows, summary};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CartrackIgnition = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
