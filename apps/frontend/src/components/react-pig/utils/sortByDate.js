const sortByDate = obj =>
  obj.sort((a, b) => {
    if (!a.date) return 1; // if the data doesnt have a date, put it last
    return new Date(b.date) - new Date(a.date);
  });

// using old syntax because this function is also used by node
export default sortByDate;
