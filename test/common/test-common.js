// @ts-check
'use strict'

const path = require('path')
const fetch = require('node-fetch').default

const { FakeApiGatewayLambda } = require('../../index.js')

class TestCommon {
  /**
   * @typedef {{
   *     env?: Record<string, string>,
   *     requestContext?: (e: object) => Promise<object> | object
   * }} Options
   *
   * @param {Options} [options]
   */
  constructor (options) {
    const env = options ? options.env : {}

    /** @type {FakeApiGatewayLambda} */
    this.lambda = new FakeApiGatewayLambda({
      port: 0,
      populateRequestContext: options && options.requestContext
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'hello.py'),
      env: env,
      httpPath: '/python',
      handler: 'lambda_handler',
      runtime: 'python3.9'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'hello.js'),
      env: env,
      httpPath: '/hello'
    })
    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'syntax-error.js'),
      env: env,
      httpPath: '/syntax'
    })
    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'runtime-error.js'),
      env: env,
      httpPath: '/runtime'
    })
  }

  /**
   * @param {Options} [options]
   */
  static async create (options) {
    const c = new TestCommon(options)
    await c.bootstrap()
    return c
  }

  /**
   * @param {string} url
   * @param {import('node-fetch').RequestInit} [init]
   * @returns {Promise<import('node-fetch').Response>}
   */
  async fetch (url, init) {
    return fetch(`http://${this.lambda.hostPort}${url}`, init)
  }

  /**
   * @returns {Promise<void>}
   */
  async bootstrap () {
    await this.lambda.bootstrap()
  }

  /**
   * @returns {Promise<void>}
   */
  async close () {
    await this.lambda.close()
  }
}

module.exports = TestCommon
