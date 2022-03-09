// @ts-check
'use strict'

const { PassThrough } = require('stream')
const { test } = require('tapzero')
const path = require('path')

const TestCommon = require('./common/test-common.js')

test('calling /hello with ENV vars 1', async (t) => {
  const common = await TestCommon.create({
    env: { TEST_GREETER: 'TEST_ENV_1' }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200, '/hello returns 200')

    const b = await res.text()
    t.equal(b, 'Hello, TEST_ENV_1!',
      '/hello can read the environment variable')
  } finally {
    await common.close()
  }
})

test('calling /hello with requestContext sync', async (t) => {
  const common = await TestCommon.create({
    requestContext: () => {
      return { greeter: 'Timothy' }
    }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200, '/hello returns 200')

    const b = await res.text()
    t.equal(b, 'Hello, Timothy!', '/hello can read the requestContext')
  } finally {
    await common.close()
  }
})

test('calling /hello with requestContext async', async (t) => {
  const common = await TestCommon.create({
    requestContext: async () => {
      return { greeter: 'Timothy' }
    }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200, '/hello returns 200')

    const b = await res.text()
    t.equal(b, 'Hello, Timothy!', '/hello works with async requestContext')
  } finally {
    await common.close()
  }
})

test('calling /hello with ENV vars 2', async (t) => {
  const common = await TestCommon.create({
    env: { TEST_GREETER: 'TEST_ENV_2' }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200, '/hello returns 200')

    const b = await res.text()
    t.equal(b, 'Hello, TEST_ENV_2!', '/hello can read env variables')
  } finally {
    await common.close()
  }
})

test('calling /hello', async (t) => {
  const common = await TestCommon.create()
  const output = []
  const info = common.lambda.functions.hello_node_lambda

  info.worker.stdout = new PassThrough()
  info.worker.stdout.on('data', (data) => output.push(data))

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200, '/hello returns 200')

    const b = await res.text()
    t.equal(b, 'Hello, World!', '/hello returns default payload')

    t.ok(output.join('\n').includes('INFO js hello'),
      'logs from js lambda are correct')
  } finally {
    await common.close()
  }
})

test('calling /hello many times', async (t) => {
  const common = await TestCommon.create()

  try {
    for (let i = 0; i < 5; i++) {
      const res = await common.fetch('/hello')
      t.equal(res.status, 200, '/hello returns 200 multiple times')

      const b = await res.text()
      t.equal(b, 'Hello, World!', '/hello returns body multiple times')
    }
  } finally {
    await common.close()
  }
})

test('calling /hello many times in parallel', async (t) => {
  const common = await TestCommon.create()

  try {
    // @type {Promise<import('node-fetch').Response>[]}
    const tasks = []
    for (let i = 0; i < 5; i++) {
      tasks.push(common.fetch('/hello'))
    }

    const responses = await Promise.all(tasks)
    for (const res of responses) {
      t.equal(res.status, 200, '/hello returns 200 in parallel')

      const b = await res.text()
      t.equal(b, 'Hello, World!', '/hello returns body in parallel')
    }
  } finally {
    await common.close()
  }
})

test('calling /hello with different args', async (t) => {
  const common = await TestCommon.create()

  try {
    const res1 = await common.fetch('/hello', {
      method: 'POST',
      body: JSON.stringify({ greeter: 'James' })
    })
    t.equal(res1.status, 200, '/hello with http body returns 200')

    const b1 = await res1.text()
    t.equal(b1, 'Hello, James!', '/hello can read http body')

    const res2 = await common.fetch('/hello?greeter=Bob')
    t.equal(res2.status, 200, '/hello with query string returns 200')

    const b2 = await res2.text()
    t.equal(b2, 'Hello, Bob!', '/hello can read querystring')

    const res3 = await common.fetch('/hello', {
      headers: [
        ['greeter', 'Charles'],
        ['greeter', 'Tim']
      ]
    })
    t.equal(res3.status, 200, '/hello with custom headers returns 200')

    const b3 = await res3.text()
    t.equal(b3, 'Hello, Charles and Tim!',
      '/hello can read custom headers')

    const res4 = await common.fetch('/hello', {
      headers: {
        greeter: 'Alice'
      }
    })
    t.equal(res4.status, 200, '/hello can read single header')

    const b4 = await res4.text()
    t.equal(b4, 'Hello, Alice!', '/hello body reads header value')
  } finally {
    await common.close()
  }
})

test('calling not found endpoint', async (t) => {
  const common = await TestCommon.create()

  try {
    const res = await common.fetch('/foo')
    t.equal(res.status, 404, 'random URL returns 403 instead of 404')

    const b = await res.text()
    t.equal(
      b,
      '{"message":"NotFound: The local server does not have this URL path"}',
      '403 body is correct'
    )
  } finally {
    await common.close()
  }
})

test('adding a lambda worker later', async (t) => {
  const common = await TestCommon.create()

  try {
    common.lambda.updateWorker({
      httpPath: '/foo',
      runtime: 'nodejs:12.x',
      handler: 'hello.handler',
      functionName: 'hello_node_lambda',
      entry: path.join(__dirname, 'lambdas', 'hello.js')
    })
    const res = await common.fetch('/foo')
    t.equal(res.status, 200, '/foo returns 200 after updateWorker()')
  } finally {
    await common.close()
  }
})

test('calling changePort', async (t) => {
  const common = await TestCommon.create()

  try {
    common.lambda.updateWorker({
      httpPath: '/foo',
      runtime: 'nodejs:12.x',
      handler: 'hello.handler',
      functionName: 'hello_node_lambda',
      entry: path.join(__dirname, 'lambdas', 'hello.js')
    })

    const oldHostPort = common.lambda.hostPort
    await common.lambda.changePort(0)

    t.notEqual(oldHostPort, common.lambda.hostPort,
      'the hostPort has changed')

    const res = await common.fetch('/foo')
    t.equal(res.status, 200, '/foo works with new port')
  } finally {
    await common.close()
  }
})

test('calling python handler', async (t) => {
  const common = await TestCommon.create()
  const output = []
  const info = common.lambda.functions.python_lambda

  info.worker.stdout = new PassThrough()
  info.worker.stdout.on('data', (data) => {
    process.stdout.write(data)
    output.push(data)
  })

  try {
    const res = await common.fetch('/python')
    t.equal(res.status, 200, '/python returns 200')

    const b = await res.text()
    t.equal(b, '"Hello from Lambda! (python)"',
      'body from python is correct')

    t.ok(output.join('\n').includes('INFO python hello'),
      'logs from python lambda are correct')
  } finally {
    await common.close()
  }
})

test('calling go handler', async (t) => {
  const common = await TestCommon.create()
  const output = []
  const info = common.lambda.functions.go_lambda

  info.worker.stdout = new PassThrough()
  info.worker.stdout.on('data', (data) => {
    process.stdout.write(data)
    output.push(data)
  })

  try {
    const res = await common.fetch('/go')
    t.equal(res.status, 200, '/go returns 200')

    const b = await res.text()
    t.equal(b, 'Hello from Lambda! (go)',
      'body from go is correct')

    t.ok(output.join('\n').includes('INFO hello from lambda'),
      'logs from go lambda are correct')
  } finally {
    await common.close()
  }
})

test('Calling a raw lambda', async (t) => {
  const common = await TestCommon.create()

  try {
    const url = '/___FAKE_API_GATEWAY_LAMBDA___RAW___?' +
      'functionName=malformed_node-lambda'

    const res = await common.fetch(url, {
      method: 'POST',
      body: '{}'
    })
    t.equal(res.status, 200, '/raw invoke returns 200')

    const b = await res.text()
    t.equal(b, '"Invalid Non HTTP response string"',
      'body from raw lambda is correct')
  } finally {
    await common.close()
  }
})
