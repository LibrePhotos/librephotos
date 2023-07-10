// group into day-month-year
const groupByDate = (inputArr) => {
  const monthGroups = inputArr.reduce((groups, item) => {
    let formattedDate = ''

    const date = new Date(item.date)
    const day = date.toLocaleDateString('en-US', { day: 'numeric' })
    const month = date.toLocaleDateString('en-US', { month: 'long' })
    const year = date.toLocaleDateString('en-US', { year: 'numeric' })

    formattedDate = `${day} ${month} ${year}`

    if (!item.date) formattedDate = 'No date'

    // const groupName = item.location

    if (!groups[formattedDate]) {
      groups[formattedDate] = [];
    }
    groups[formattedDate].push(item)
    return groups;
  }, {});

  const groupArrays = Object.keys(monthGroups).map((date) => {
    // for location we're just gonna get the first item in the monthGroup which has a location
    let location = ''
    monthGroups[date].some(i => {
      if (i.location) location = i.location
    })

    return {
      date,
      location,
      items: monthGroups[date]
    };
  });

  return groupArrays
}

// using old syntax because this function is also used by node
module.exports = groupByDate