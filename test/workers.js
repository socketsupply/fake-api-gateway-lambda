// @ts-check
'use strict'

const path = require('path')
const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

test('calling /hello with ENV vars 1', async (t) => {
  const common = await TestCommon.create({
    env: { TEST_GREETER: 'TEST_ENV_1' }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, 'Hello, TEST_ENV_1!')
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
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, 'Hello, Timothy!')
  } finally {
    await common.close()
  }
})

test('calling /hello with requestContext async', async (t) => {
  const common = await TestCommon.create({
    requestContext: () => {
      return { greeter: 'Timothy' }
    }
  })

  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, 'Hello, Timothy!')
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
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, 'Hello, TEST_ENV_2!')
  } finally {
    await common.close()
  }
})

test('calling /hello', async (t) => {
  const common = await TestCommon.create()
  try {
    const res = await common.fetch('/hello')
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, 'Hello, World!')
  } finally {
    await common.close()
  }
})

test('calling /hello many times', async (t) => {
  const common = await TestCommon.create()

  try {
    for (let i = 0; i < 5; i++) {
      const res = await common.fetch('/hello')
      t.equal(res.status, 200)

      const b = await res.text()
      t.equal(b, 'Hello, World!')
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
      t.equal(res.status, 200)

      const b = await res.text()
      t.equal(b, 'Hello, World!')
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
    t.equal(res1.status, 200)

    const b1 = await res1.text()
    t.equal(b1, 'Hello, James!')

    const res2 = await common.fetch('/hello?greeter=Bob')
    t.equal(res2.status, 200)

    const b2 = await res2.text()
    t.equal(b2, 'Hello, Bob!')

    const res3 = await common.fetch('/hello', {
      headers: [
        ['greeter', 'Charles'],
        ['greeter', 'Tim']
      ]
    })
    t.equal(res3.status, 200)

    const b3 = await res3.text()
    t.equal(b3, 'Hello, Charles and Tim!')

    const res4 = await common.fetch('/hello', {
      headers: {
        greeter: 'Alice'
      }
    })
    t.equal(res4.status, 200)

    const b4 = await res4.text()
    t.equal(b4, 'Hello, Alice!')
  } finally {
    await common.close()
  }
})

test('calling not found endpoint', async (t) => {
  const common = await TestCommon.create()

  try {
    const res = await common.fetch('/foo')
    t.equal(res.status, 403)

    const b = await res.text()
    t.equal(b, '{"message":"Forbidden"}')
  } finally {
    await common.close()
  }
})

test('adding a lambda worker later', async (t) => {
  const common = await TestCommon.create()

  try {
    common.lambda.updateWorker({
      httpPath: '/foo',
      entry: path.join(__dirname, 'lambdas', 'hello.js')
    })
    const res = await common.fetch('/foo')
    t.equal(res.status, 200)
  } finally {
    await common.close()
  }
})

test('calling changePort', async (t) => {
  const common = await TestCommon.create()

  try {
    common.lambda.updateWorker({
      httpPath: '/foo',
      entry: path.join(__dirname, 'lambdas', 'hello.js')
    })

    const oldHostPort = common.lambda.hostPort
    await common.lambda.changePort(0)

    t.notEqual(oldHostPort, common.lambda.hostPort,
      'the hostPort has changed')

    const res = await common.fetch('/foo')
    t.equal(res.status, 200)
  } finally {
    await common.close()
  }
})

test('calling python handler', async (t) => {
  const common = await TestCommon.create()

  try {
    const res = await common.fetch('/python')
    t.equal(res.status, 200)

    const b = await res.text()
    t.equal(b, '"Hello from Lambda! (python)"')
  } finally {
    await common.close()
  }
})
