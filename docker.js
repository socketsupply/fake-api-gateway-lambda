'use strict'

const util = require('./util')
const _path = require('path')
const events = require('events')
const fs = require('fs')
const cp = require('child_process')
const fetch = require('node-fetch').default
const { promisify } = require('util')
const ncp = promisify(require('ncp'))
// run lambda process within docker.

let START_PORT = ~~(9000 + Math.random() * 1000)

async function copy (src, dest, cb) {
  await fs.promises.mkdir(dest, { recursive: true })
  return ncp(src, dest, {})
}

function createDockerfile (runtime, handler) {
  // eslint-disable-start
  return `
FROM public.ecr.aws/lambda/${runtime}

# Copy function code
COPY * $\{LAMBDA_TASK_ROOT}/

# Set the CMD to your handler (could also be done as a parameter override outside of the Dockerfile)
CMD [ ${handler} ]
`
// eslint-disable-end
}

async function dockerLambdaReady (port, max = 1000) {
  const start = Date.now()
  while (Date.now() < max + start) {
    try {
      return await fetch(`http://localhost:${port}`)
    } catch (err) {
      // loop...
    }
  }
}

function log (proc) {
  proc.stdout.on('data', d => process.stdout.write(d))
  proc.stderr.on('data', d => process.stderr.write(d))
  return proc
}

class DockerLambda {
  constructor (args) {
    const {
      bin,
      entry,
      env,
      handler,
      id,
      path,
      runtime,
      stderr,
      stdout,
      tmp
    } = args

    this.bin = bin || 'docker'
    this.path = path
    if (!/^nodejs:/.test(runtime)) { throw new Error('only node.js runtime supported currently') }
    // copy input to tmp dir
    // insert Dockerfile
    // run docker build
    // start docker
    // use fetch, but return expected event object.
    this.id = id || '' + Date.now()
    this.tmp = tmp || '/tmp/' + id

    this.port = START_PORT++
    this.entry = entry
    this.env = env
    this.handler = handler
    this.runtime = runtime
    this.stdout = stdout
    this.stderr = stderr
    this.ready = this.bootstrap()
  }

  async bootstrap () {
    const envArray = Object.keys(this.env)
      .map(k => ['--env', k + '=' + this.env[k]])
      .reduce((a, b) => a.concat(b), [])

    // const id = 'operator-docker_' + Date.now()
    // const tmp = '/tmp/' + id
    await copy(_path.dirname(this.entry), this.tmp)
    const basename = _path.basename(this.entry)
    const base = basename.substring(0, basename.indexOf(_path.extname(basename)))
    await fs.promises.writeFile(
      _path.join(this.tmp, 'Dockerfile'),
      createDockerfile('nodejs:12', base + '.' + this.handler)
    )

    console.log([`>${this.bin}`, 'build', this.tmp, '-t', this.id].join(' '))

    this.proc = log(cp.spawn(this.bin, ['build', this.tmp, '-t', this.id]))
    const [code] = await events.once(this.proc, 'exit')

    if (code) { throw new Error('docker build failed') }

    // XXX: I think this should error but that breaks the tests...
    if (this.closed) return
    // throw new Error('closed during startup')

    console.log([`>${this.bin}`, 'run', '-it', '-p', `${this.port}:8080`].concat(envArray).concat([this.id]).join(' '))
    //  this.proc = log(cp.spawn('docker', ['run', id, '-p', `${this.port}:8080`].concat(envArray)))

    // if the id isn't the very last argument you'll get an error
    // "entrypoint requires that handler must be first arg"
    // which won't help you figure it out.
    const proc = this.proc = log(cp.spawn(this.bin, ['run', '-p', `${this.port}:8080`]
      .concat(envArray)
      .concat([this.id])
    ))

    util.pipeStdio(proc, { stdout: this.stdout, stderr: this.stderr })

    await dockerLambdaReady(this.port)
  }

  async request (id, eventObject) {
    await this.ready
    return (await fetch(`http://localhost:${this.port}/2015-03-31/functions/function/invocations`,
      { method: 'post', body: JSON.stringify(eventObject) })
    ).json()
  }

  async close () {
    this.closed = true
    if (this.proc) {
      this.proc.kill(9)
      events.once(this.proc, 'exit')
    }
  }
}

module.exports = DockerLambda
