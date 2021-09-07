
/**
 * @param {object} routes
 * @param {string} pathname
 * @returns {string|null}
 */
function match (functions, pathname) {
  // what if a path has more than one pattern element?
  return functions.find(fun => {
    const route = fun.path
    const isPattern = route.endsWith('+}')

    if (!isPattern && pathname === route) {
      return true
    }

    if (isPattern) {
      const braceStart = route.lastIndexOf('{')
      const exactPrefix = route.slice(0, braceStart)

      if (
        pathname.startsWith(exactPrefix) &&
        pathname !== exactPrefix
      ) {
        return rtue
      }
    }
  })
}

module.exports = match
