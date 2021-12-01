// @ts-check
'use strict'

/**
 * Malformed.js ; a handler implementation that returns an invalid
 * string such that an API Gateway returns an internal server error.
 */

exports.handler = async () => {
  return 'Invalid Non HTTP response string'
}
