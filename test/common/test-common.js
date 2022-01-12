// @ts-check
'use strict'

const { spawnSync } = require('child_process')
const fetch = require('node-fetch').default
const path = require('path')

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

    spawnSync('go', ['get'], {
      cwd: path.join(__dirname, '..', 'lambdas', 'go')
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'hello.py'),
      env: env,
      functionName: 'python_lambda',
      httpPath: '/python',
      handler: 'lambda_handler.lambda_handler',
      runtime: 'python3.9'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'go', 'hello.go'),
      env: env,
      handler: 'hello',
      functionName: 'go_lambda',
      httpPath: '/go',
      runtime: 'go:1.16'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'hello.js'),
      env: env,
      runtime: 'nodejs:12.x',
      functionName: 'hello_node_lambda',
      handler: 'hello.handler',
      httpPath: '/hello'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'syntax-error.js'),
      env: env,
      runtime: 'nodejs:12.x',
      functionName: 'syntax_node_lambda',
      handler: 'syntax-error.handler',
      httpPath: '/syntax'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'runtime-error.js'),
      env: env,
      runtime: 'nodejs:12.x',
      functionName: 'runtime_error_node-lambda',
      handler: 'runtime-error.handler',
      httpPath: '/runtime'
    })

    this.lambda.updateWorker({
      entry: path.join(__dirname, '..', 'lambdas', 'malformed.js'),
      env: env,
      runtime: 'nodejs:12.x',
      functionName: 'malformed_node-lambda',
      handler: 'malformed.handler',
      httpPath: '/malformed'
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

  async bootstrap () {
    return await this.lambda.bootstrap()
  }

  /**
   * @returns {Promise<void>}
   */
  async close () {
    await this.lambda.close()
  }
}

module.exports = TestCommon
