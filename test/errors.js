const tape = require('@pre-bundled/tape')
const path = require('path')
const { FakeApiGatewayLambda } = require('../index.js')
const fetch = require('node-fetch').default

const gateway = new FakeApiGatewayLambda({
  port: 0,
  env: {},
  docker: false,
  routes: {
    '/hello': path.join(__dirname, 'lambdas', 'hello.js'),
    '/syntax': path.join(__dirname, 'lambdas', 'syntax-error.js'),
    '/runtime': path.join(__dirname, 'lambdas', 'runtime-error.js')

  }
})

tape('setup', async (t) => {
  await gateway.bootstrap()
  t.end()
})

tape('syntax error', async (t) => {
  try {
    await gateway.dispatch('1', { path: '/syntax' })
  } catch (err) {
    t.ok(err)
    console.error(err)
    t.end()
  }
})

tape('runtime error', async (t) => {
  let r
  try {
    r = await gateway.dispatch('1', { path: '/runtime' })
    t.fail()
  } catch (err) {
    t.ok(err)
    console.error('ERR', err)
  }
  console.log(r)
  t.end()
})

tape('dns-poison', async (t) => {
  const result = await fetch(`http://${gateway.hostPort}/hello`, {headers: {
    host: 'http://dns-poisoning-attack.com'
  }})
  console.log(result)
  t.equal(result.status, 403)
  t.end()
})

tape('local website attack', async (t) => {
  const result = await fetch(`http://${gateway.hostPort}/hello`, {headers: {
    referer: 'http://example.com'
  }})
  console.log(result)
  t.equal(result.status, 403)
  t.end()
})

tape('fetch syntax error', async (t) => {
  const result = await fetch(`http://${gateway.hostPort}/syntax`)
  console.log(result)
  t.equal(result.status, 500)
  t.end()
})



tape('teardown', async (t) => {
  await gateway.close()
  t.end()
})