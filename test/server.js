// @ts-check
'use strict'

const { test } = require('tapzero')

const { FakeApiGatewayLambda } = require('../index.js')
const TestCommon = require('./common/test-common.js')

test('listening on same port twice returns an err', async (t) => {
  const common = await TestCommon.create()

  try {
    const lambdaServer = common.lambda
    const port = lambdaServer.hostPort.split(':')[1]

    t.ok(port, 'server listens on a port')

    const lambdaServer2 = new FakeApiGatewayLambda({
      port: parseInt(port, 10)
    })

    const r = await lambdaServer2.bootstrap()
    t.ok(r, 'r exists')

    t.ok(r.err, 'bootstrap() existing port returns err')
    t.equal(r.err.code, 'EADDRINUSE',
      'err code is already listening')

    await lambdaServer2.close()
  } finally {
    await common.close()
  }
})
