const tape = require('@pre-bundled/tape')
const path = require('path')
const { FakeApiGatewayLambda } = require('../index.js')
const fetch = require('node-fetch').default

tape('syntax error', async (t) => {
  const gateway = new FakeApiGatewayLambda({
    port: 0,
    env: {},
    docker: false,
    routes: {
      '/syntax': path.join(__dirname, 'lambdas', 'syntax-error.js')
    }
  })

  await gateway.bootstrap()
  try {
    await gateway.dispatch('1', { path: '/syntax' })
  } catch (err) {
    t.ok(err)
    console.error(err)
    gateway.close()
    t.end()
  }
})

tape('runtime error', async (t) => {
  const gateway = new FakeApiGatewayLambda({
    port: 0,
    env: {},
    docker: false,
    routes: {
      '/runtime': path.join(__dirname, 'lambdas', 'runtime-error.js')
    }
  })

  await gateway.bootstrap()
  let r
  try {
    r = await gateway.dispatch('1', { path: '/runtime' })
    t.fail()
  } catch (err) {
    t.ok(err)
    console.error('ERR', err)
    gateway.close()
  }
  console.log(r)
  t.end()
})

tape('fetch syntax error', async (t) => {
  const gateway = new FakeApiGatewayLambda({
    port: 0,
    env: {},
    docker: false,
    routes: {
      '/syntax': path.join(__dirname, 'lambdas', 'syntax-error.js')
    }
  })

  await gateway.bootstrap()

  const result = await fetch(`http://${gateway.hostPort}/syntax`)
  console.log(result)
  t.equal(result.status, 500)
  gateway.close()
  t.end()
})

tape('fetch runtime error', async (t) => {
  const gateway = new FakeApiGatewayLambda({
    port: 0,
    env: {},
    docker: false,
    routes: {
      '/runtime': path.join(__dirname, 'lambdas', 'runtime-error.js')
    }
  })

  await gateway.bootstrap()

  const result = await fetch(`http://${gateway.hostPort}/runtime`)
  t.equal(result.status, 500)
  gateway.close()
  t.end()
})
