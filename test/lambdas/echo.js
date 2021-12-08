exports.handler = function (event, _context, callback) {
  callback(null, {
    statusCode: 200,
    headers: {
      'Content-Type': '*/*'
    },
    body: event.resource + ' ' + event.path
  })
}
