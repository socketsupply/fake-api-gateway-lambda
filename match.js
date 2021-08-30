

/**
 * @param {object} routes
 * @param {string} pathname
 * @returns {string|null}
 */
function match (routes, pathname) {


  // what if a path has more than one pattern element?
  for (const route in routes) {
    const isPattern = route.endsWith('+}')

    if (!isPattern && pathname === route) {
      return route
    }

    if (isPattern) {
      const braceStart = route.lastIndexOf('{')
      const exactPrefix = route.slice(0, braceStart)

      if (
        pathname.startsWith(exactPrefix) &&
        pathname !== exactPrefix
      ) {
        return route
      }
    }

  }
  return null
}

module.exports = match
