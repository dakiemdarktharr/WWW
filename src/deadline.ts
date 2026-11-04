/** Convert a user's wall-clock input to an unambiguous UTC instant. */
export function localDeadlineToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Choose a valid deadline date and time.');
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = new Date(value);
  // Date normalizes impossible calendar times and daylight-saving gaps. Reject
  // that normalization instead of silently changing the chosen deadline.
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute) ||
    date.getSeconds() !== Number(second)
  )
    throw new Error('This date or local time does not exist. Choose another deadline.');
  return date.toISOString();
}

export function deadlineToLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function deadlineFromForm(form: Pick<FormData, 'get'>): string | null {
  const mode = form.get('deadlineMode');
  if (mode === 'none') return null;
  if (mode !== 'scheduled') throw new Error('Choose No deadline or Set deadline.');
  const selected = localDeadlineToIso(String(form.get('deadlineLocal') || ''));
  const original = String(form.get('deadlineOriginal') || '');
  // An unchanged existing date retains its exact instant, including the second
  // occurrence of an ambiguous daylight-saving time and any subsecond precision.
  if (
    original &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(original) &&
    deadlineToLocalInput(original) === deadlineToLocalInput(selected)
  )
    return new Date(original).toISOString();
  return selected;
}
