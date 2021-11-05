// @ts-check
'use strict'

const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

test('syntax error', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/syntax')
    t.equal(resp.status, 500)

    const body = await resp.json()

    t.ok(body)
    t.equal(body.message, 'Internal Server Error')
  } finally {
    await common.close()
  }
})

test('runtime error', async (t) => {
  const common = await TestCommon.create()

  try {
    const resp = await common.fetch('/runtime')
    t.equal(resp.status, 500)

    const body = await resp.json()

    t.ok(body)
    t.equal(body.message, 'Internal Server Error')
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
    t.equal(result.status, 403)
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
    t.equal(resp.status, 403)
  } finally {
    await common.close()
  }
})
