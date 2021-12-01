// @ts-check
'use strict'

const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

test('syntax error', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/syntax')
    t.equal(resp.status, 500, 'statusCode is 500 for /syntax')

    const body = await resp.json()

    t.ok(body, '/syntax returns body')
    t.equal(body.message, 'Internal Server Error',
      '/syntax returns Interal Server Error')
  } finally {
    await common.close()
  }
})

test('runtime error', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/runtime')
    t.equal(resp.status, 500, 'statusCode is 500 for /runtime')

    const body = await resp.json()

    t.ok(body, '/runtime returns http body')
    t.equal(body.message, 'Internal Server Error',
      '/runtime returns Internal Server Error')
  } finally {
    await common.close()
  }
})

test('malformed error', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/malformed')
    t.equal(resp.status, 500, 'expected 500')

    const body = await resp.json()

    t.ok(body, '/malformed returns a body')
    t.equal(body.message, 'Lambda returned invalid HTTP result',
      'got invalid http result back')
  } finally {
    await common.close()
  }
})

test('dns-poison', async (t) => {
  const common = await TestCommon.create()

  try {
    const result = await common.fetch('/hello', {
      headers: {
        host: 'http://dns-poisoning-attack.com'
      }
    })
    t.equal(result.status, 403, 'bad host header returns 403')
  } finally {
    await common.close()
  }
})

test('local website attack', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/hello', {
      headers: {
        referer: 'http://example.com'
      }
    })
    t.equal(resp.status, 403, 'bad referer header returns 403')
  } finally {
    await common.close()
  }
})
