// What `new Date(date)` holds: null is the epoch, undefined an invalid date.
function timeOf(date: string | null | undefined): number {
  if (date === null) return 0;
  if (date === undefined) return Number.NaN;
  return new Date(date).getTime();
}

const sortByDate = <T extends { date?: string | null }>(obj: T[]): T[] =>
  obj.sort((a, b) => {
    if (!a.date) return 1; // if the data doesnt have a date, put it last
    return timeOf(b.date) - timeOf(a.date);
  });

// using old syntax because this function is also used by node
export default sortByDate;
