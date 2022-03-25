// @ts-check
'use strict'

const { PassThrough } = require('stream')
const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

test('calling /esm with ENV vars 1', async (t) => {
  const common = await TestCommon.create({
    env: { TEST_GREETER: 'TEST_ENV_1' }
  })

  try {
    const res = await common.fetch('/esm')
    t.equal(res.status, 200, '/esm returns 200')

    const b = await res.text()
    t.equal(b, 'esm, TEST_ENV_1!',
      '/esm can read the environment variable')
  } finally {
    await common.close()
  }
})

test('calling /esm with requestContext sync', async (t) => {
  const common = await TestCommon.create({
    requestContext: () => {
      return { greeter: 'Timothy' }
    }
  })

  try {
    const res = await common.fetch('/esm')
    t.equal(res.status, 200, '/esm returns 200')

    const b = await res.text()
    t.equal(b, 'esm, Timothy!', '/esm can read the requestContext')
  } finally {
    await common.close()
  }
})

test('calling /esm with requestContext async', async (t) => {
  const common = await TestCommon.create({
    requestContext: async () => {
      return { greeter: 'Timothy' }
    }
  })

  try {
    const res = await common.fetch('/esm')
    t.equal(res.status, 200, '/esm returns 200')

    const b = await res.text()
    t.equal(b, 'esm, Timothy!', '/esm works with async requestContext')
  } finally {
    await common.close()
  }
})

test('calling /esm with ENV vars 2', async (t) => {
  const common = await TestCommon.create({
    env: { TEST_GREETER: 'TEST_ENV_2' }
  })

  try {
    const res = await common.fetch('/esm')
    t.equal(res.status, 200, '/esm returns 200')

    const b = await res.text()
    t.equal(b, 'esm, TEST_ENV_2!', '/esm can read env variables')
  } finally {
    await common.close()
  }
})

test('calling /esm', async (t) => {
  const common = await TestCommon.create()
  const output = []
  const info = common.lambda.functions.node_esm_lambda

  info.worker.stdout = new PassThrough()
  info.worker.stdout.on('data', (data) => output.push(data))

  try {
    const res = await common.fetch('/esm')
    t.equal(res.status, 200, '/esm returns 200')

    const b = await res.text()
    t.equal(b, 'esm, World!', '/esm returns default payload')

    t.ok(output.join('\n').includes('INFO js esm'),
      'logs from js lambda are correct')
  } finally {
    await common.close()
  }
})

test('calling /esm many times', async (t) => {
  const common = await TestCommon.create()

  try {
    for (let i = 0; i < 5; i++) {
      const res = await common.fetch('/esm')
      t.equal(res.status, 200, '/esm returns 200 multiple times')

      const b = await res.text()
      t.equal(b, 'esm, World!', '/esm returns body multiple times')
    }
  } finally {
    await common.close()
  }
})

test('calling /esm many times in parallel', async (t) => {
  const common = await TestCommon.create()

  try {
    // @type {Promise<import('node-fetch').Response>[]}
    const tasks = []
    for (let i = 0; i < 5; i++) {
      tasks.push(common.fetch('/esm'))
    }

    const responses = await Promise.all(tasks)
    for (const res of responses) {
      t.equal(res.status, 200, '/esm returns 200 in parallel')

      const b = await res.text()
      t.equal(b, 'esm, World!', '/esm returns body in parallel')
    }
  } finally {
    await common.close()
  }
})

test('calling /esm with different args', async (t) => {
  const common = await TestCommon.create()

  try {
    const res1 = await common.fetch('/esm', {
      method: 'POST',
      body: JSON.stringify({ greeter: 'James' })
    })
    t.equal(res1.status, 200, '/esm with http body returns 200')

    const b1 = await res1.text()
    t.equal(b1, 'esm, James!', '/esm can read http body')

    const res2 = await common.fetch('/esm?greeter=Bob')
    t.equal(res2.status, 200, '/esm with query string returns 200')

    const b2 = await res2.text()
    t.equal(b2, 'esm, Bob!', '/esm can read querystring')

    const res3 = await common.fetch('/esm', {
      headers: [
        ['greeter', 'Charles'],
        ['greeter', 'Tim']
      ]
    })
    t.equal(res3.status, 200, '/esm with custom headers returns 200')

    const b3 = await res3.text()
    t.equal(b3, 'esm, Charles and Tim!',
      '/esm can read custom headers')

    const res4 = await common.fetch('/esm', {
      headers: {
        greeter: 'Alice'
      }
    })
    t.equal(res4.status, 200, '/esm can read single header')

    const b4 = await res4.text()
    t.equal(b4, 'esm, Alice!', '/esm body reads header value')
  } finally {
    await common.close()
  }
})
