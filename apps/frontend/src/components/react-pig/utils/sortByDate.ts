// What `new Date(date)` holds: null is the epoch, undefined an invalid date.
// Not util/dateUtils: this module also runs outside the app (under node), and
// sorting only needs the instant, so it reads the Date directly.
function timeOf(date: string | null | undefined): number {
  if (date === null) return 0;
  if (date === undefined) return Number.NaN;
  // eslint-disable-next-line ban/date-constructor -- sorting reads the instant here; this module runs under node too, so it cannot use dateUtils
  return new Date(date).getTime();
}

const sortByDate = <T extends { date?: string | null }>(obj: T[]): T[] =>
  obj.sort((a, b) => {
    if (!a.date) return 1; // if the data doesnt have a date, put it last
    return timeOf(b.date) - timeOf(a.date);
  });

// using old syntax because this function is also used by node
export default sortByDate;
