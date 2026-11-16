/**
 * Business runs on India time. Must be the first import of the server entry so every Date
 * month / day boundary (dashboards, reports, reminders) uses IST even on a UTC host.
 */
process.env.TZ = process.env.TZ || "Asia/Kolkata";
export {};
