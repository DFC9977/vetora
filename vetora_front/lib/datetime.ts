export function parseOdooDatetime(value: string): Date {
  // Odoo sends 'YYYY-MM-DD HH:MM:SS'. Treat it as local time.
  const iso = value.replace(" ", "T");
  return new Date(iso);
}

export function formatTimeHM(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getDaySlots(startHour = 7, endHour = 21, stepMinutes = 15): Date[] {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0, 0);
  const slots: Date[] = [];
  const totalMinutes = (endHour - startHour) * 60;
  for (let m = 0; m < totalMinutes; m += stepMinutes) {
    slots.push(new Date(base.getTime() + m * 60 * 1000));
  }
  return slots;
}

export function getDaySlotsForDate(dateStr: string, startHour = 7, endHour = 21, stepMinutes = 15): Date[] {
  const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
  const base = new Date(year, (month || 1) - 1, day || 1, startHour, 0, 0, 0);
  const slots: Date[] = [];
  const totalMinutes = (endHour - startHour) * 60;
  for (let m = 0; m < totalMinutes; m += stepMinutes) {
    slots.push(new Date(base.getTime() + m * 60 * 1000));
  }
  return slots;
}

export function toOdooDatetimeLocal(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

