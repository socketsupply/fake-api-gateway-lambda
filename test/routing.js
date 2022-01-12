// @ts-check
'use strict'

const path = require('path')
const { test } = require('tapzero')

const TestCommon = require('./common/test-common.js')

test('calling different routes', async (t) => {
  const common = await TestCommon.create()

  try {
    registerAll([
      '/users',
      '/users/{userId}',
      '/users/{userId}/status',
      '/users/{userId}/teams/{teamId}',
      '/nested/hello/{proxy+}',
      '/proxy/{proxy+}'
    ])

    const r1 = await common.fetch('/users')
    const t1 = await r1.text()
    t.equal(t1, '/users /users', 'users api works')

    const r2 = await common.fetch('/users/bob')
    const t2 = await r2.text()
    t.equal(t2, '/users/{userId} /users/bob', 'users/bob api works')

    const r3 = await common.fetch('/users/bob/foobar')
    t.equal(r3.status, 403, 'users/bob/foobar api returns 403')

    const r4 = await common.fetch('/foobar')
    t.equal(r4.status, 403, 'foobar api returns 403')

    const r5 = await common.fetch('/users/bob/status')
    const t5 = await r5.text()
    t.equal(
      t5,
      '/users/{userId}/status /users/bob/status',
      'users/bob/status api works'
    )

    const r6 = await common.fetch('/users/bob/teams/teamName')
    const t6 = await r6.text()
    t.equal(
      t6,
      '/users/{userId}/teams/{teamId} /users/bob/teams/teamName',
      'users/bob/teams/teamName api works'
    )

    const r7 = await common.fetch('/users/bob/teams/teamName/nested')
    t.equal(r7.status, 403, 'users/bob/teams/teamName/nested api returns 403')

    const r8 = await common.fetch('/users/bob/teams')
    t.equal(r8.status, 403, 'users/bob/teams api returns 403')

    const r9 = await common.fetch('/nested/hello/foo/bar/baz')
    const t9 = await r9.text()
    t.equal(
      t9,
      '/nested/hello/{proxy+} /nested/hello/foo/bar/baz',
      'nested/hello/foo/bar/baz api works'
    )

    const r10 = await common.fetch('/proxy/1')
    const t10 = await r10.text()
    t.equal(t10, '/proxy/{proxy+} /proxy/1', 'proxy/1 api works')

    const r11 = await common.fetch('/proxy')
    t.equal(r11.status, 403, 'proxy api returns 403')

    const r12 = await common.fetch('/proxy/')
    t.equal(r12.status, 403, 'proxy/ api returns 403')
  } finally {
    await common.close()
  }

  function registerAll (httpPaths) {
    let counter = 0
    for (const httpPath of httpPaths) {
      common.lambda.updateWorker({
        runtime: 'nodejs:12.x',
        httpPath: httpPath,
        handler: 'echo.handler',
        functionName: `_temp_${++counter}`,
        entry: path.join(__dirname, 'lambdas', 'echo.js')
      })
    }
  }
})
