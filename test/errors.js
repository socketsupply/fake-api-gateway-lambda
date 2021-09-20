const tape = require('@pre-bundled/tape')
const path = require('path')
const { FakeApiGatewayLambda } = require('../index.js')

tape('syntax error', async (t) => {
  var gateway = new FakeApiGatewayLambda({
      port: 0,
      env: {},
      docker: false,
      routes: {
        '/syntax': path.join(__dirname, 'lambdas', 'syntax-error.js')
      }
    })

  await gateway.bootstrap()
  try {
     await gateway.dispatch('1', {path:'/syntax'})
  } catch (err) {
    t.ok(err)
    console.error(err)
    gateway.close()
    t.end()
  }
})

tape('runtime error', async (t) => {
  var gateway = new FakeApiGatewayLambda({
      port: 0,
      env: {},
      docker: false,
      routes: {
        '/runtime': path.join(__dirname, 'lambdas', 'runtime-error.js')
      }
    })

  await gateway.bootstrap()
  var r
  try {
     r = await gateway.dispatch('1', {path:'/runtime'})
    t.fail()
  } catch (err) {
    t.ok(err)
    console.error("ERR", err)
    gateway.close()
  }
  console.log(r)
  t.end()
})