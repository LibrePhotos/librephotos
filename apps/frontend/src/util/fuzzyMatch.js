export const fuzzy_match = (str,pattern) => {
    if (pattern.split("").length > 0) {
        pattern = pattern.split("").reduce(function(a,b){ return a+".*"+b; });
        return (new RegExp(pattern)).test(str);
    } else {
        return false
    }
};
