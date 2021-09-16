'use strict'

const tape = require('@pre-bundled/tape')
const tapeCluster = require('tape-cluster')
const path = require('path')
const fetch = require('node-fetch').default

const { FakeApiGatewayLambda } = require('../index.js')

class TestHarness {
  /**
   * @param {{
   *     env?: Record<string, string>,
   *     requestContext?: (e: object) => Promise<object> | object
   * }} [options]
   */
  constructor (options) {
    /** @type {FakeApiGatewayLambda} */
    this.lambda = new FakeApiGatewayLambda({
      port: 0,
      env: options ? options.env : {},
      docker: false,
      populateRequestContext: options && options.requestContext,
      routes: {
        '/hello': path.join(__dirname, 'lambdas', 'hello.js')
      }
    })
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

exports.test = tapeCluster(tape, TestHarness)
