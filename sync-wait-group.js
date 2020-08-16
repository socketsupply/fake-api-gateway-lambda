// @ts-check
'use strict'

const RESOLVED_PROMISE = Promise.resolve()

class WaitGroup {
  /**
   * @constructor
   */
  constructor () {
    /** @type {number} */
    this.counter = 0
    /** @type {number} */
    this.waitCounter = 0
    /** @type {Promise<void> | null} */
    this.waitPendingPromise = null
    /** @type {(() => void) | null} */
    this.waitPendingResolve = null
    /** @type {boolean} */
    this.finished = false
  }

  /**
   * @param {number} delta
   * @returns {void}
   */
  add (delta) {
    if (this.finished) {
      panic('sync: WaitGroup misuse: WaitGroup is reused')
    }

    this.counter += delta

    if (this.counter < 0) {
      panic('sync: negative WaitGroup counter')
      return
    }

    if (this.counter > 0 || this.waitCounter === 0) {
      return
    }

    this.finished = true
    this.notify()
  }

  /**
   * @returns {void}
   */
  done () {
    this.add(-1)
  }

  /**
   * @returns {Promise<void>}
   */
  wait () {
    if (this.counter === 0) {
      return RESOLVED_PROMISE
    }

    this.waitCounter++
    if (this.waitPendingPromise) {
      return this.waitPendingPromise
    }

    // tslint:disable-next-line: promise-must-complete
    this.waitPendingPromise = new Promise((resolve) => {
      this.waitPendingResolve = resolve
    })
    return this.waitPendingPromise
  }

  /**
   * @returns {void}
   */
  notify () {
    if (this.waitPendingResolve) {
      const waitPendingResolve = this.waitPendingResolve
      this.waitPendingResolve = null
      waitPendingResolve()
    }
  }
}
exports.WaitGroup = WaitGroup

/**
 * @param {string} message
 * @returns {void}
 */
function panic (message) {
  const error = new Error(message)
  process.nextTick(() => {
    throw error
  })
}
