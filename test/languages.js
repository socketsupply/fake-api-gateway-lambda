// @ts-check
'use strict'

const { PassThrough } = require('stream')
const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

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

    const eventLine = output.find((line) => {
      return line.includes('INFO event')
    })
    t.ok(eventLine)
    t.ok(eventLine.includes(`'path': '/python'`))
    t.ok(eventLine.includes(`'body': ''`))
    t.ok(eventLine.includes(` 'httpMethod': 'GET',`))

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
